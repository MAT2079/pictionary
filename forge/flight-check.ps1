<#
.SYNOPSIS
  Windows flight check for AI Pictionary's Forge + worker stack (spec §16).
.DESCRIPTION
  Verifies each link in the chain with PASS/FAIL, ending with an end-to-end test
  job submitted via the cloud server that should return images.
.EXAMPLE
  ./flight-check.ps1 -RenderUrl "https://your-app.onrender.com" -WorkerSecret "secret"
#>
param(
  [string]$RenderUrl = $env:RENDER_URL,
  [string]$WorkerSecret = $env:WORKER_SECRET,
  [string]$ForgeUrl = "http://127.0.0.1:7860",
  [string]$Checkpoint = "dreamshaperXL"
)

$ErrorActionPreference = "Continue"
$fails = 0

function Step($name, [scriptblock]$test) {
  Write-Host -NoNewline ("[ .. ] {0}" -f $name)
  try {
    $ok = & $test
    if ($ok) { Write-Host ("`r[ " + [char]0x2713 + " ] {0}" -f $name) -ForegroundColor Green }
    else { Write-Host ("`r[ X ] {0}" -f $name) -ForegroundColor Red; $script:fails++ }
  } catch {
    Write-Host ("`r[ X ] {0} -- {1}" -f $name, $_.Exception.Message) -ForegroundColor Red
    $script:fails++
  }
}

Write-Host "AI Pictionary flight check (Windows)" -ForegroundColor Cyan
Write-Host "RenderUrl=$RenderUrl  ForgeUrl=$ForgeUrl`n"

Step "Docker is running" {
  docker info *> $null; $LASTEXITCODE -eq 0
}

Step "GPU visible inside a throwaway CUDA container" {
  docker run --rm --gpus all nvidia/cuda:12.1.1-base-ubuntu22.04 nvidia-smi *> $null
  $LASTEXITCODE -eq 0
}

Step "Compose stack is up (forge + worker)" {
  $ps = docker compose -f "$PSScriptRoot/docker-compose.yml" ps --format json 2>$null
  $ps -and ($ps -match "forge") -and ($ps -match "worker")
}

Step "Forge lists the target checkpoint" {
  $models = Invoke-RestMethod -Uri "$ForgeUrl/sdapi/v1/sd-models" -TimeoutSec 20
  ($models | Where-Object { $_.model_name -match $Checkpoint -or $_.title -match $Checkpoint }).Count -gt 0
}

Step "Forge txt2img returns an image" {
  $body = @{ prompt = "a red apple on a table"; steps = 6; cfg_scale = 2; width = 768; height = 768; batch_size = 1 } | ConvertTo-Json
  $r = Invoke-RestMethod -Uri "$ForgeUrl/sdapi/v1/txt2img" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 180
  $r.images -and $r.images.Count -gt 0
}

Step "Worker is polling the server (/worker/health)" {
  if (-not $RenderUrl) { throw "RenderUrl not set" }
  $h = Invoke-RestMethod -Uri "$RenderUrl/worker/health" -Headers @{ Authorization = "Bearer $WorkerSecret" } -TimeoutSec 15
  $h.ok -and $h.lastPollAt -gt 0 -and ((([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) - $h.lastPollAt) -lt 60000)
}

Step "End-to-end test job via the server returns images" {
  if (-not $RenderUrl) { throw "RenderUrl not set" }
  $r = Invoke-RestMethod -Uri "$RenderUrl/worker/test-job" -Method Post `
    -Headers @{ Authorization = "Bearer $WorkerSecret" } -ContentType "application/json" `
    -Body '{}' -TimeoutSec 120
  $r.ok -and $r.images -gt 0
}

Write-Host ""
if ($fails -eq 0) { Write-Host "ALL CHECKS PASSED" -ForegroundColor Green; exit 0 }
else { Write-Host "$fails CHECK(S) FAILED" -ForegroundColor Red; exit 1 }
