# Forge on macOS (backup, native)

Containerization is intentionally **not** used on macOS because Docker on the Mac
cannot pass through the Apple GPU. Run Forge **natively** with MPS, and run the
poll-worker natively too. Nothing listens on a public interface.

Do the steps in order, then run `flight-check.sh`.

## 1. Prerequisites

```bash
# Homebrew, then:
brew install cmake protobuf rust python@3.10 git wget
```

Apple Silicon (M1/M2/M3) recommended. Intel Macs will be very slow.

## 2. Install Forge natively

```bash
git clone https://github.com/lllyasviel/stable-diffusion-webui-forge.git
cd stable-diffusion-webui-forge
```

## 3. Place checkpoints (spec §18)

- **Primary:** SDXL Lightning (DreamShaper XL Lightning 4-step) →
  `models/Stable-diffusion/`.
- **Backup:** DreamShaper 8 (SD 1.5) → `models/Stable-diffusion/`.
- Optional LCM LoRA → `models/Lora/`.

## 4. Launch with the API + MPS flags

```bash
./webui.sh --api \
  --skip-torch-cuda-test --upcast-sampling --no-half-vae \
  --listen=False --port 7860
```

Forge binds `127.0.0.1:7860`. The `--api` flag exposes `/sdapi/v1/*`.

> **Memory:** SDXL at 1024×1024 can exhaust unified memory. If you see crashes or
> black images, lower **width/height to 768–896** and **batchSize to 2** in the
> operator Settings panel.

## 5. Run the worker natively

From this repo's `worker/` folder:

```bash
npm install
npm run build
RENDER_URL="https://YOUR-APP.onrender.com" \
WORKER_SECRET="THE-SECRET-FROM-RENDER-SETTINGS" \
FORGE_URL="http://127.0.0.1:7860" \
node dist/index.js
```

## 6. Flight check

```bash
cd forge
./flight-check.sh "https://YOUR-APP.onrender.com" "THE-SECRET"
```

It mirrors the Windows checks minus the Docker/NVIDIA steps: Forge reachable →
lists the checkpoint → a test `txt2img` returns an image → worker polling →
end-to-end job via the server returns images. It also reminds you to lower batch
size / resolution if memory is tight.
