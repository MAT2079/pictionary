#!/usr/bin/env bash
# One-shot macOS setup for AI Pictionary (spec §16, §18). Does the scriptable
# work, in order:
#   1. Download the §18 checkpoints/LoRA into ./models (idempotent, resumable).
#   2. (optional) Launch native Forge with the MPS/API flags if --forge-dir given.
#   3. (optional) Build + start the poll-worker in the background.
#   4. Run the flight check (flight-check.sh) to verify the chain.
# The un-scriptable prerequisites (Homebrew, cloning Forge) are in
# forge-setup-mac.md and are done once first.
#
# Usage:
#   ./forge-setup-mac.sh <RENDER_URL> <WORKER_SECRET> [FORGE_URL] [CHECKPOINT] \
#       [--forge-dir /path/to/forge] [--skip-models] [--skip-worker] \
#       [--force-download] [--skip-primary] [--skip-lora]

set -uo pipefail

# ============================================================================
#  FILL IN YOUR TOKENS HERE (optional) — paste between the quotes if a model
#  download needs auth. Leave blank to fall back to the CIVITAI_TOKEN / HF_TOKEN
#  env vars, or to skip auth entirely.
# ============================================================================
CIVITAI_TOKEN="${CIVITAI_TOKEN:-}"   # Civitai API key — for the primary SDXL checkpoint
HF_TOKEN="${HF_TOKEN:-}"             # HuggingFace token — only for gated repos
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODELS_DIR="${MODELS_DIR:-$SCRIPT_DIR/models}"
WORKER_DIR="$SCRIPT_DIR/../worker"
GREEN='\033[0;32m'; RED='\033[0;31m'; YEL='\033[0;33m'; CYAN='\033[0;36m'; GRAY='\033[0;90m'; NC='\033[0m'

SKIP_MODELS=0; FORCE_DOWNLOAD=0; SKIP_PRIMARY=0; SKIP_LORA=0; SKIP_WORKER=0; FORGE_DIR=""
POSITIONAL=()
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-models) SKIP_MODELS=1 ;;
    --force-download) FORCE_DOWNLOAD=1 ;;
    --skip-primary) SKIP_PRIMARY=1 ;;
    --skip-lora) SKIP_LORA=1 ;;
    --skip-worker) SKIP_WORKER=1 ;;
    --forge-dir) shift; FORGE_DIR="${1:-}" ;;
    *) POSITIONAL+=("$1") ;;
  esac
  shift
done
RENDER_URL="${POSITIONAL[0]:-${RENDER_URL:-}}"
WORKER_SECRET="${POSITIONAL[1]:-${WORKER_SECRET:-}}"
FORGE_URL="${POSITIONAL[2]:-http://127.0.0.1:7860}"
CHECKPOINT="${POSITIONAL[3]:-dreamshaper}"

fail() { echo -e "${RED}ERROR: $1${NC}"; exit 1; }

PRIMARY_URL="${PRIMARY_URL:-https://civitai.com/api/download/models/351306}"
BACKUP_URL="${BACKUP_URL:-https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors}"
LCM_LORA_URL="${LCM_LORA_URL:-https://huggingface.co/latent-consistency/lcm-lora-sdv1-5/resolve/main/pytorch_lora_weights.safetensors}"
MODELS=(
  "DreamShaper XL Lightning (SDXL, PRIMARY)|$PRIMARY_URL|Stable-diffusion/dreamshaperXL_lightningDPMSDE.safetensors|civitai|0|$SKIP_PRIMARY"
  "DreamShaper 8 (SD 1.5, BACKUP)|$BACKUP_URL|Stable-diffusion/DreamShaper_8_pruned.safetensors|hf|0|0"
  "LCM LoRA (SD 1.5, optional)|$LCM_LORA_URL|Lora/lcm-lora-sdv1-5.safetensors|hf|1|$SKIP_LORA"
)

download_models() { # spec §18 — idempotent, resumable
  echo -e "${CYAN}[1/4] Downloading models into $MODELS_DIR...${NC}"
  local hard_fail=0
  for entry in "${MODELS[@]}"; do
    IFS='|' read -r name url dest source optional skip <<< "$entry"
    full="$MODELS_DIR/$dest"; mkdir -p "$(dirname "$full")"
    if [ "$skip" = "1" ]; then echo -e "  ${GRAY}[skip] $name${NC}"; continue; fi
    if [ "$FORCE_DOWNLOAD" != "1" ] && [ -f "$full" ]; then
      size=$(wc -c < "$full" 2>/dev/null || echo 0)
      if [ "$size" -gt 1048576 ]; then echo -e "  ${GREEN}[have] $name ($((size/1048576)) MB)${NC}"; continue; fi
    fi
    fetch_url="$url"; headers=()
    if [ "$source" = "civitai" ] && [ -n "$CIVITAI_TOKEN" ]; then
      if [[ "$url" == *"?"* ]]; then fetch_url="$url&token=$CIVITAI_TOKEN"; else fetch_url="$url?token=$CIVITAI_TOKEN"; fi
    fi
    [ "$source" = "hf" ] && [ -n "$HF_TOKEN" ] && headers=(-H "Authorization: Bearer $HF_TOKEN")
    echo -e "  ${YEL}[get ] $name${NC}"
    if curl -L --fail --retry 3 --retry-delay 5 -C - "${headers[@]}" -o "$full" "$fetch_url"; then
      size=$(wc -c < "$full" 2>/dev/null || echo 0)
      if [ "$size" -gt 1048576 ]; then echo -e "  ${GREEN}[done] $name${NC}"; continue; fi
    fi
    size=$(wc -c < "$full" 2>/dev/null || echo 0); [ "$size" -le 1048576 ] && rm -f "$full"
    if [ "$source" = "civitai" ]; then
      echo -e "  ${RED}[FAIL] $name (set CIVITAI_TOKEN at the top, or PRIMARY_URL to the current link)${NC}"
    else echo -e "  ${RED}[FAIL] $name${NC}"; fi
    [ "$optional" = "1" ] || hard_fail=$((hard_fail+1))
  done
  [ "$hard_fail" -gt 0 ] && fail "$hard_fail required model(s) failed to download (see hints above)."
}

launch_forge() {
  echo -e "${CYAN}[2/4] Launching native Forge in $FORGE_DIR ...${NC}"
  [ -x "$FORGE_DIR/webui.sh" ] || fail "no webui.sh in --forge-dir ($FORGE_DIR)"
  if curl -fsS "$FORGE_URL/sdapi/v1/sd-models" >/dev/null 2>&1; then
    echo -e "  ${GREEN}Forge already running.${NC}"; return
  fi
  ( cd "$FORGE_DIR" && nohup ./webui.sh --api --skip-torch-cuda-test --upcast-sampling \
      --no-half-vae --port 7860 >"$SCRIPT_DIR/forge.log" 2>&1 & )
  echo -e "  ${GRAY}Waiting for Forge (up to 300s; logs: forge.log)...${NC}"
  for _ in $(seq 1 60); do
    curl -fsS "$FORGE_URL/sdapi/v1/sd-models" >/dev/null 2>&1 && { echo -e "  ${GREEN}Forge is up.${NC}"; return; }
    sleep 5
  done
  echo -e "  ${YEL}(warning) Forge didn't come up in time; see forge.log.${NC}"
}

start_worker() {
  echo -e "${CYAN}[3/4] Starting the poll-worker...${NC}"
  [ -n "$RENDER_URL" ] && [ -n "$WORKER_SECRET" ] || { echo -e "  ${YEL}(skip) RENDER_URL/WORKER_SECRET not set${NC}"; return; }
  if [ ! -f "$WORKER_DIR/dist/index.js" ]; then
    echo -e "  ${GRAY}Building worker...${NC}"
    ( cd "$WORKER_DIR" && npm install --no-audit --no-fund && npm run build ) || fail "worker build failed"
  fi
  RENDER_URL="$RENDER_URL" WORKER_SECRET="$WORKER_SECRET" FORGE_URL="$FORGE_URL" \
    nohup node "$WORKER_DIR/dist/index.js" >"$SCRIPT_DIR/worker.log" 2>&1 &
  echo -e "  ${GREEN}Worker started (pid $!, logs: worker.log).${NC}"
  sleep 3
}

echo -e "${CYAN}AI Pictionary — macOS setup${NC}\n"
[ "$SKIP_MODELS" = "1" ] && echo -e "${GRAY}[1/4] Skipping model download.${NC}" || download_models
[ -n "$FORGE_DIR" ] && launch_forge || echo -e "${GRAY}[2/4] No --forge-dir; launch native Forge yourself (see forge-setup-mac.md).${NC}"
[ "$SKIP_WORKER" = "1" ] && echo -e "${GRAY}[3/4] Skipping worker start.${NC}" || start_worker

echo -e "\n${CYAN}[4/4] Running flight check...${NC}"
exec "$SCRIPT_DIR/flight-check.sh" "$RENDER_URL" "$WORKER_SECRET" "$FORGE_URL" "$CHECKPOINT"
