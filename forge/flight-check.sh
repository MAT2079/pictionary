#!/usr/bin/env bash
# macOS flight check for AI Pictionary (spec §16). PURE VERIFIER — runs the
# PASS/FAIL chain only, no install/download, so it's safe to re-run before every
# event (it's a step in the MANUAL showtime sequence). First-time setup (models,
# worker) is done by forge-setup-mac.sh, which calls this script at the end.
# Mirrors the Windows checks minus the Docker/NVIDIA steps (Forge runs natively).
#
# Usage: ./flight-check.sh <RENDER_URL> <WORKER_SECRET> [FORGE_URL] [CHECKPOINT]

set -uo pipefail

RENDER_URL="${1:-${RENDER_URL:-}}"
WORKER_SECRET="${2:-${WORKER_SECRET:-}}"
FORGE_URL="${3:-http://127.0.0.1:7860}"
CHECKPOINT="${4:-dreamshaper}"

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
fails=0

step() { # step "name" command...
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf "${GREEN}[ ✓ ]${NC} %s\n" "$name"
  else
    printf "${RED}[ X ]${NC} %s\n" "$name"
    fails=$((fails+1))
  fi
}

echo -e "${CYAN}AI Pictionary flight check (macOS)${NC}"
echo "RENDER_URL=$RENDER_URL  FORGE_URL=$FORGE_URL"
echo "Note: if generation crashes or returns black images, lower width/height to"
echo "768–896 and batchSize to 2 in the operator Settings (unified-memory limits)."
echo

forge_reachable() { curl -fsS "$FORGE_URL/sdapi/v1/sd-models" >/dev/null; }
forge_has_checkpoint() { curl -fsS "$FORGE_URL/sdapi/v1/sd-models" | grep -iq "$CHECKPOINT"; }
forge_txt2img() {
  curl -fsS -X POST "$FORGE_URL/sdapi/v1/txt2img" \
    -H 'content-type: application/json' \
    -d '{"prompt":"a red apple on a table","steps":6,"cfg_scale":2,"width":768,"height":768,"batch_size":1}' \
    | grep -q '"images"'
}
worker_polling() {
  [ -n "$RENDER_URL" ] || return 1
  local last now
  last=$(curl -fsS -H "Authorization: Bearer $WORKER_SECRET" "$RENDER_URL/worker/health" | sed -n 's/.*"lastPollAt":\([0-9]*\).*/\1/p')
  [ -n "$last" ] && [ "$last" -gt 0 ] || return 1
  now=$(($(date +%s) * 1000))
  [ $((now - last)) -lt 60000 ]
}
end_to_end() {
  [ -n "$RENDER_URL" ] || return 1
  curl -fsS -X POST "$RENDER_URL/worker/test-job" \
    -H "Authorization: Bearer $WORKER_SECRET" -H 'content-type: application/json' \
    --max-time 120 -d '{}' | grep -q '"ok":true'
}

step "Forge is reachable"                       forge_reachable
step "Forge lists the target checkpoint"        forge_has_checkpoint
step "Forge txt2img returns an image"           forge_txt2img
step "Worker is polling the server"             worker_polling
step "End-to-end test job returns images"       end_to_end

echo
if [ "$fails" -eq 0 ]; then
  echo -e "${GREEN}ALL CHECKS PASSED${NC}"; exit 0
else
  echo -e "${RED}$fails CHECK(S) FAILED${NC}"; exit 1
fi
