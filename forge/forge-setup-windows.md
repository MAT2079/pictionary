# Forge on Windows (primary, containerized)

The GPU path: Forge + the poll-worker run as containers via Docker Desktop with
the WSL2 backend. Nothing on this machine listens on a public interface — the
worker makes outbound connections only.

Everything scriptable (download models, write `.env`, bring the stack up, verify)
is done by **`forge-setup-windows.ps1`**. This guide covers only the one-time
prerequisites that *can't* be scripted, then you run that one script.

---

## Prerequisites (one-time, manual)

These need reboots, GUI installers, and admin consent, so they aren't scripted.

### 1. Docker Desktop with the WSL2 backend
1. Install **WSL2**: PowerShell as Admin → `wsl --install`, reboot.
2. Install **Docker Desktop**; in *Settings → General* enable **Use the WSL 2
   based engine**, and under *Resources → WSL Integration* enable your distro.
3. Confirm: `docker run --rm hello-world` succeeds.

### 2. Current NVIDIA driver (WSL CUDA)
1. Install the latest **NVIDIA Game Ready / Studio driver** on Windows (this
   provides CUDA inside WSL2 — you do **not** install a CUDA toolkit in WSL).
2. The **NVIDIA Container Toolkit** ships with recent Docker Desktop + driver
   combos.

### 3. Verify GPU-in-container
```powershell
docker run --rm --gpus all nvidia/cuda:12.1.1-base-ubuntu22.04 nvidia-smi
```
You should see your GPU. Fix this before continuing if it fails (update driver /
Docker Desktop; enable virtualization in BIOS).

---

## Run setup (one script)

From the `forge/` folder:

```powershell
cd forge
./forge-setup-windows.ps1 -RenderUrl "https://YOUR-APP.onrender.com" -WorkerSecret "THE-SECRET"
```

It runs, in order:

1. **Download models** (spec §18) into `forge/models` — idempotent, resumable.
   - **Primary:** DreamShaper XL (Lightning, 4-step) SDXL →
     `dreamshaperXL_lightningDPMSDE.safetensors` (matches the default Settings
     checkpoint name).
   - **Backup:** DreamShaper 8 (SD 1.5). **Optional:** LCM LoRA.
2. **Write `.env`** next to `docker-compose.yml` with `RENDER_URL` +
   `WORKER_SECRET`.
3. **`docker compose up -d`** and wait for Forge to become healthy (the first run
   builds the image and bootstraps torch — several minutes).
4. **Flight check** — verifies the whole chain (`flight-check.ps1`), ending with
   an end-to-end test job that should return images.

### Tokens (optional)
The primary checkpoint is on **Civitai**, which may need a free API token. Open
`forge-setup-windows.ps1` and paste it into the marked block near the top:

```powershell
$CIVITAI_TOKEN = "your-token"   # for the primary SDXL Lightning checkpoint
$HF_TOKEN      = ""             # only for gated HuggingFace repos
```
(Or set the `CIVITAI_TOKEN` / `HF_TOKEN` env vars.) If a default link rotates,
override with `$env:PRIMARY_URL="https://civitai.com/api/download/models/XXXXXX"`.

### Useful flags
- `-SkipModels` — stack up + verify only (models already present).
- `-SkipStack` — don't touch the stack (e.g. it's already running).
- `-ForceDownload`, `-SkipPrimary`, `-SkipLora`, `-HealthTimeoutSec <n>`.

### Re-runs before an event
You don't need the full setup each time. To just re-verify, run the pure checker:
```powershell
./flight-check.ps1 -RenderUrl "https://YOUR-APP.onrender.com" -WorkerSecret "THE-SECRET"
```

---

## Troubleshooting

- **Forge OOM / black images:** drop width/height to 768–896 and/or batchSize in
  the operator Settings.
- **Worker offline in Settings:** check `RENDER_URL` / `WORKER_SECRET` match the
  server; `docker compose -f forge/docker-compose.yml logs worker`.
- **Slow first generation:** the model loads on first use; warm it with one test
  job before the event.
- **Forge debug:** the compose file publishes Forge to `127.0.0.1:7860` for local
  debugging only (never `0.0.0.0`). `curl http://127.0.0.1:7860/sdapi/v1/sd-models`.
