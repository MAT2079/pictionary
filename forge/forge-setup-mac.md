# Forge on macOS (backup, native)

Containerization is intentionally **not** used on macOS — Docker on the Mac can't
pass through the Apple GPU. Forge runs **natively** with MPS, and the poll-worker
runs natively too. Nothing listens on a public interface.

Everything scriptable (download models, optionally launch Forge + the worker,
verify) is done by **`forge-setup-mac.sh`**. This guide covers only the one-time
prerequisites, then you run that script.

---

## Prerequisites (one-time, manual)

### 1. Homebrew packages
```bash
brew install cmake protobuf rust python@3.10 git wget
```
Apple Silicon (M1/M2/M3) recommended; Intel Macs will be very slow.

### 2. Clone Forge natively
```bash
git clone https://github.com/lllyasviel/stable-diffusion-webui-forge.git
```
Note its path — you'll pass it to the setup script as `--forge-dir`.

---

## Run setup (one script)

From this repo's `forge/` folder:

```bash
cd forge
./forge-setup-mac.sh "https://YOUR-APP.onrender.com" "THE-SECRET" \
  --forge-dir /path/to/stable-diffusion-webui-forge
```

It runs, in order:

1. **Download models** (spec §18) into `forge/models` — idempotent, resumable
   (DreamShaper XL Lightning primary, DreamShaper 8 backup, optional LCM LoRA).
   The primary filename matches the default Settings checkpoint
   (`dreamshaperXL_lightningDPMSDE`).
2. **Launch native Forge** (if `--forge-dir` given) with the MPS/API flags
   (`--api --skip-torch-cuda-test --upcast-sampling --no-half-vae --port 7860`),
   logging to `forge.log`, and waits for it to come up.
3. **Start the poll-worker** in the background (builds it first if needed),
   logging to `worker.log`.
4. **Flight check** — verifies the chain (`flight-check.sh`).

Point native Forge's models at this repo's `forge/models/Stable-diffusion`
(symlink or copy) so it lists the downloaded checkpoints. If you prefer to launch
Forge yourself, omit `--forge-dir` and start it before running the script.

### Tokens (optional)
The primary checkpoint is on **Civitai**, which may need a free API token. Open
`forge-setup-mac.sh` and paste it into the marked block near the top:

```bash
CIVITAI_TOKEN="your-token"   # for the primary SDXL checkpoint
HF_TOKEN=""                  # only for gated HuggingFace repos
```
(Or export the env vars.) Override a rotated link with
`PRIMARY_URL="https://civitai.com/api/download/models/XXXXXX"`.

### Useful flags
`--skip-models`, `--skip-worker`, `--force-download`, `--skip-primary`,
`--skip-lora`, `--forge-dir <path>`.

### Re-runs before an event
To just re-verify (once Forge + worker are up), run the pure checker:
```bash
./flight-check.sh "https://YOUR-APP.onrender.com" "THE-SECRET"
```

---

## Memory note

SDXL at 1024×1024 can exhaust unified memory. If you see crashes or black images,
lower **width/height to 768–896** and **batchSize to 2** in the operator Settings
panel.
