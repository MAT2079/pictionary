<#
.SYNOPSIS
  One-shot Windows setup for AI Pictionary's Forge + worker stack (spec §16, §18).
.DESCRIPTION
  Does everything scriptable, in order:
    1. Download the §18 checkpoints/LoRA into ./models (idempotent, resumable).
    2. Write/merge .env (RENDER_URL + WORKER_SECRET) for docker compose.
    3. docker compose up -d  and wait for Forge to become healthy.
    4. Run the flight check (flight-check.ps1) to verify the whole chain.
  The un-scriptable prerequisites (Docker Desktop + WSL2, NVIDIA driver) are in
  forge-setup-windows.md and must be done once first.
.EXAMPLE
  ./forge-setup-windows.ps1 -RenderUrl "https://your-app.onrender.com" -WorkerSecret "secret"
.EXAMPLE
  ./forge-setup-windows.ps1 -SkipModels         # stack up + verify only
#>
param(
  [string]$RenderUrl = $env:RENDER_URL,
  [string]$WorkerSecret = $env:WORKER_SECRET,
  [string]$ModelsDir = (Join-Path $PSScriptRoot 'models'),
  [switch]$SkipModels,
  [switch]$ForceDownload,
  [switch]$SkipPrimary,
  [switch]$SkipLora,
  [switch]$SkipStack,            # don't bring the stack up (already running)
  [int]$HealthTimeoutSec = 300
)

# ============================================================================
#  FILL IN YOUR TOKENS HERE (optional) - paste between the quotes if a model
#  download needs auth. Leave blank to fall back to the CIVITAI_TOKEN / HF_TOKEN
#  env vars, or to skip auth entirely.
# ============================================================================
$CIVITAI_TOKEN = ""   # Civitai API key - for the primary SDXL Lightning checkpoint
$HF_TOKEN      = ""   # HuggingFace token - only needed for gated repos
# ============================================================================
if (-not $CIVITAI_TOKEN) { $CIVITAI_TOKEN = $env:CIVITAI_TOKEN }
if (-not $HF_TOKEN)      { $HF_TOKEN = $env:HF_TOKEN }

$ErrorActionPreference = "Continue"
$Compose = "$PSScriptRoot/docker-compose.yml"
$EnvFile = "$PSScriptRoot/.env"
$ForgeUrl = "http://127.0.0.1:7860"

function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# ---- Model list (spec §18). Override a rotated URL via *_URL env vars. -------
$Models = @(
  @{ Name='DreamShaper XL Lightning (SDXL, PRIMARY)';
     Url=$(if ($env:PRIMARY_URL) { $env:PRIMARY_URL } else { 'https://civitai.com/api/download/models/351306' });
     Dest='Stable-diffusion/dreamshaperXL_lightningDPMSDE.safetensors'; Source='civitai'; Optional=$false; Skip=$SkipPrimary },
  @{ Name='DreamShaper 8 (SD 1.5, BACKUP)';
     Url=$(if ($env:BACKUP_URL) { $env:BACKUP_URL } else { 'https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors' });
     Dest='Stable-diffusion/DreamShaper_8_pruned.safetensors'; Source='hf'; Optional=$false; Skip=$false },
  @{ Name='LCM LoRA (SD 1.5, optional)';
     Url=$(if ($env:LCM_LORA_URL) { $env:LCM_LORA_URL } else { 'https://huggingface.co/latent-consistency/lcm-lora-sdv1-5/resolve/main/pytorch_lora_weights.safetensors' });
     Dest='Lora/lcm-lora-sdv1-5.safetensors'; Source='hf'; Optional=$true; Skip=$SkipLora }
)

function Invoke-ModelDownloads {
  Write-Host "[1/4] Downloading models into $ModelsDir (idempotent)..." -ForegroundColor Cyan
  $hardFail = 0
  foreach ($m in $Models) {
    $dest = Join-Path $ModelsDir $m.Dest
    New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
    if ($m.Skip) { Write-Host "  [skip] $($m.Name)" -ForegroundColor DarkGray; continue }
    if ((Test-Path $dest) -and -not $ForceDownload -and (Get-Item $dest).Length -gt 1MB) {
      Write-Host ("  [have] {0} ({1} MB)" -f $m.Name, [math]::Round((Get-Item $dest).Length/1MB,1)) -ForegroundColor Green
      continue
    }
    $url = $m.Url; $headers = @()
    if ($m.Source -eq 'civitai' -and $CIVITAI_TOKEN) {
      $sep = if ($url -match '\?') { '&' } else { '?' }; $url = "$url$sep" + "token=$CIVITAI_TOKEN"
    }
    if ($m.Source -eq 'hf' -and $HF_TOKEN) { $headers += @('-H', "Authorization: Bearer $HF_TOKEN") }
    Write-Host "  [get ] $($m.Name)" -ForegroundColor Yellow
    & curl.exe @(@('-L','--fail','--retry','3','--retry-delay','5','-C','-','-o',$dest) + $headers + @($url))
    if ($LASTEXITCODE -eq 0 -and (Test-Path $dest) -and (Get-Item $dest).Length -gt 1MB) {
      Write-Host "  [done] $($m.Name)" -ForegroundColor Green
    } else {
      if ((Test-Path $dest) -and ((Get-Item $dest).Length -le 1MB)) { Remove-Item $dest -Force -ErrorAction SilentlyContinue }
      $hint = if ($m.Source -eq 'civitai') { ' (set $CIVITAI_TOKEN at the top, or $env:PRIMARY_URL to the current link)' } else { '' }
      $color = if ($m.Optional) { 'DarkYellow' } else { 'Red' }
      Write-Host "  [FAIL] $($m.Name)$hint" -ForegroundColor $color
      if (-not $m.Optional) { $hardFail++ }
    }
  }
  if ($hardFail -gt 0) { Fail "$hardFail required model(s) failed to download (see hints above)." }
}

function Write-EnvFile {
  Write-Host "[2/4] Writing $EnvFile ..." -ForegroundColor Cyan
  $lines = [ordered]@{}
  if (Test-Path $EnvFile) {
    foreach ($l in Get-Content $EnvFile) {
      if ($l -match '^([A-Z0-9_]+)=(.*)$') { $lines[$Matches[1]] = $Matches[2] }
    }
  }
  if ($RenderUrl) { $lines['RENDER_URL'] = $RenderUrl }
  if ($WorkerSecret) { $lines['WORKER_SECRET'] = $WorkerSecret }
  if (-not $lines['RENDER_URL']) { Write-Host "  (warning) RENDER_URL not set; the worker cannot reach the server" -ForegroundColor DarkYellow }
  if (-not $lines['WORKER_SECRET']) { Write-Host "  (warning) WORKER_SECRET not set; worker auth will fail" -ForegroundColor DarkYellow }
  ($lines.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n" | Set-Content -Path $EnvFile -Encoding ascii
  Write-Host "  RENDER_URL=$($lines['RENDER_URL'])" -ForegroundColor DarkGray
}

function Start-Stack {
  Write-Host "[3/4] docker compose up -d ..." -ForegroundColor Cyan
  docker compose -f $Compose up -d
  if ($LASTEXITCODE -ne 0) { Fail "docker compose up failed (is Docker Desktop running?)." }
  Write-Host "  Waiting for Forge to become healthy (up to ${HealthTimeoutSec}s; first run builds the image + bootstraps torch)..." -ForegroundColor DarkGray
  $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-RestMethod -Uri "$ForgeUrl/sdapi/v1/sd-models" -TimeoutSec 5 | Out-Null
      Write-Host "  Forge is up." -ForegroundColor Green
      return
    } catch { Start-Sleep -Seconds 5; Write-Host "  ...still warming up" -ForegroundColor DarkGray }
  }
  Write-Host "  (warning) Forge did not report healthy within ${HealthTimeoutSec}s; the flight check below will show the problem." -ForegroundColor DarkYellow
}

Write-Host "AI Pictionary - Windows setup`n" -ForegroundColor Cyan

if (-not $SkipModels) { Invoke-ModelDownloads } else { Write-Host "[1/4] Skipping model download." -ForegroundColor DarkGray }
Write-EnvFile
if (-not $SkipStack) { Start-Stack } else { Write-Host "[3/4] Skipping stack start." -ForegroundColor DarkGray }

Write-Host "`n[4/4] Running flight check..." -ForegroundColor Cyan
& "$PSScriptRoot/flight-check.ps1" -RenderUrl $RenderUrl -WorkerSecret $WorkerSecret -ForgeUrl $ForgeUrl
exit $LASTEXITCODE
