# Forge on Windows (primary, containerized)

This is the primary GPU path: Forge + the poll-worker run as containers via
Docker Desktop with the WSL2 backend. Nothing on this machine listens on a
public interface — the worker makes outbound connections only.

Do the steps **in order**. Then run `flight-check.ps1`.

## 1. Install Docker Desktop with the WSL2 backend

1. Install **WSL2**: open PowerShell as Admin and run `wsl --install`, reboot.
2. Install **Docker Desktop** and in *Settings → General* enable **Use the WSL 2
   based engine**. In *Settings → Resources → WSL Integration*, enable your
   distro.
3. Confirm: `docker run --rm hello-world` succeeds.

## 2. Install a current NVIDIA driver (WSL CUDA)

1. Install the latest **NVIDIA Game Ready / Studio driver** on Windows (this
   provides CUDA inside WSL2 — you do **not** install a CUDA toolkit in WSL).
2. The **NVIDIA Container Toolkit** ships with recent Docker Desktop + driver
   combos. Verify GPU passthrough in the next step.

## 3. Verify GPU-in-container

```powershell
docker run --rm --gpus all nvidia/cuda:12.1.1-base-ubuntu22.04 nvidia-smi
```

You should see your GPU listed. If this fails, fix it before continuing (update
the driver / Docker Desktop; ensure virtualization is enabled in BIOS).

## 4. Download checkpoints (spec §18)

Place model files on the host under `forge/models` (mounted into the container):

- **Primary:** an **SDXL Lightning** checkpoint — default **DreamShaper XL
  (Lightning, 4-step)** → `forge/models/Stable-diffusion/`.
- **Backup:** **DreamShaper 8 (SD 1.5)** → `forge/models/Stable-diffusion/`.
- Optional **LCM LoRA** → `forge/models/Lora/`.

Create the subfolders if they don't exist:

```powershell
mkdir forge\models\Stable-diffusion, forge\models\Lora, forge\models\VAE -Force
```

The default checkpoint name in Settings is `dreamshaperXL_lightningDPMSDE`. Make
sure it matches what Forge lists (see step 6); adjust in the operator **Settings
→ Image generation → checkpoint** field if your filename differs.

## 5. Start the stack

From the `forge/` folder, create a `.env` next to `docker-compose.yml`:

```
RENDER_URL=https://YOUR-APP.onrender.com
WORKER_SECRET=THE-SECRET-FROM-RENDER-SETTINGS
```

Then:

```powershell
docker compose up -d
```

The first run downloads the CUDA base and lets Forge bootstrap its venv + torch;
this can take several minutes. Watch progress with `docker compose logs -f forge`.

## 6. Confirm Forge sees the model

```powershell
curl http://127.0.0.1:7860/sdapi/v1/sd-models
```

(the compose file publishes Forge to `127.0.0.1:7860` for debugging only). The
target checkpoint should appear in the list.

## 7. Flight check

```powershell
cd forge
./flight-check.ps1 -RenderUrl "https://YOUR-APP.onrender.com" -WorkerSecret "THE-SECRET"
```

It verifies, PASS/FAIL per step: Docker running → GPU-in-container → stack up →
Forge lists the checkpoint → a test `txt2img` returns an image → the worker is
polling → an end-to-end job submitted via the server returns images.

## Troubleshooting

- **Forge OOM / black images:** drop width/height to 768–896 and/or batchSize in
  Settings.
- **Worker offline in Settings:** check `RENDER_URL` and `WORKER_SECRET` match
  the server; `docker compose logs worker`.
- **Slow first generation:** the model loads on first use; warm it with one test
  job before the event.
