# AI Pictionary

A party game where teams write image-generation prompts under a **forbidden-word**
constraint, and the other teams guess the hidden target from the generated image.

Built to the spec in [`ai-pictionary-spec.md`](ai-pictionary-spec.md). One Node
repository: an Express + WebSocket game server with in-memory state, JSON config,
and five browser UIs, plus a thin client that drives a local Forge (A1111)
instance over a tunnel.

---

## How it plays

Each team elects a champion who joins on their phone. On a team's turn the
**prompter** sees a secret target word ("Lion") plus a list of forbidden words
they may not type. With 60s on the clock they write an image prompt that evokes
the target without tripping the list. Four candidate images are generated, the
prompter picks the best, it's projected, and every other team races to guess.
Points are awarded, the actual prompt is revealed for laughs, and play moves on.

```
LOBBY → REVEAL → COMPOSE → GENERATING → PICK → GUESS → SCORE → (next team) → FINAL
```

## The five clients

| Client | Route | Access | Purpose |
|---|---|---|---|
| Operator console | `/operator` | Admin password | Run the game; veto/override; live scores |
| Settings tab | `/operator/settings` | Admin password | All live configuration |
| Prompter station | `/play` | Open (host-side screen) | Compose prompt, pick image |
| Presentation | `/present` | Open (projector, fullscreen) | Audience view + join QR |
| Champion phone | `/join` | Open (QR target) | Join, name team, guess |

`GET /` redirects to `/present`. `GET /healthz` is a liveness probe.

## Architecture

- **Server** (this repo, on Render or locally): state machine, scoring,
  validation, prompt pool, WebSocket sync. Serves all UIs. State lives in
  **server memory** — no database. Timers are **server-authoritative**.
- **Forge** (on a Mac, locally): SDXL/SD1.5 image generation via the A1111 API,
  launched with `--api`. The server calls it at `FORGE_URL`.
- **Tunnel** (`cloudflared`): exposes local Forge at a public HTTPS URL so the
  cloud server can reach it. The operator pastes that URL into Settings each
  event (it changes on every launch).

Config and content (settings, prompt pool, trivia, profanity) load from
committed JSON under [`config/`](config/) at boot and are mutable in memory at
runtime. Because Render's free disk is ephemeral, runtime edits are **not**
written to disk — use **Export / Import settings** and **Export scores** in the
Settings tab to carry state across sessions.

## Project layout

```
config/            committed JSON: settings, prompts, trivia, profanity
src/
  server.js        Express + ws; role-aware state projection; admin gating
  state.js         authoritative game state machine + server-side timers
  config.js        load/mutate in-memory config & content
  validation.js    charset sanitize, whole-word forbidden + profanity, guess match
  scoring.js       per-turn scoring (pure function)
  forge.js         txt2img client + JPEG compression + model list + test
public/            the five HTML UIs + styles.css + common.js (WS/clock helper)
render.yaml        Render Blueprint (provisions the web service)
```

---

## Run locally

```bash
npm install
ADMIN_PASSWORD=secret PORT=3000 npm start
```

Open:
- `http://localhost:3000/operator` (log in with the admin password)
- `http://localhost:3000/present` (projector / lobby QR)
- `http://localhost:3000/play` (prompter station)
- phones → `http://<your-LAN-IP>:3000/join`

> On Windows PowerShell: `$env:ADMIN_PASSWORD="secret"; $env:PORT="3000"; npm start`

### Environment variables (bootstrap only)

| Var | Source | Purpose |
|---|---|---|
| `PORT` | Injected by Render | Server binds `0.0.0.0:$PORT`. |
| `ADMIN_PASSWORD` | Render Blueprint (`generateValue`) or set manually | Gates `/operator` and Settings. |

Everything else lives in the Settings tab. If `ADMIN_PASSWORD` is unset the
server defaults to `changeme` and warns — set it for any real use.

## Deploy to Render

The repo ships a Blueprint ([`render.yaml`](render.yaml)). Connect the GitHub
repo in Render → it provisions a free Node web service, generates
`ADMIN_PASSWORD`, runs `npm install && npm run build`, and starts with
`npm start`. WebSockets work over the standard HTTP upgrade. No database.

Free web services sleep after ~15 min idle, so **warm the URL a minute before
kickoff** (just open it). State is in memory and resets only on redeploy/spin-down.

---

## Event-day runbook

1. **Warm the server** — open the Render URL a minute early.
2. **Start Forge** on the Mac with the API on: `./webui.sh --api` (listens on
   `127.0.0.1:7860`).
3. **Start the tunnel:** `cloudflared tunnel --url http://localhost:7860` and copy
   the printed `https://<random>.trycloudflare.com` URL.
4. **Settings tab:** paste that URL into `FORGE_URL`, click **Load models from
   Forge**, pick the checkpoint, then **Test Connection / Generate Test Image**
   and confirm an image comes back. Save.
5. **Curate the pool:** confirm there are at least as many available
   `PromptEntry` items as teams (the operator console warns otherwise); reset
   used flags if reusing a pool; import a saved settings JSON if you have one.
6. **Open the projector** to `/present` (fullscreen) and `/play` on the host
   screen for the prompter.
7. **Champions scan the QR** on the presentation lobby and enter team names.
8. **Operator → Start Game** and run the turns.

If the tunnel drops, relaunch step 3 and re-paste the new URL into Settings.

## All-local fallback (unreliable venue internet)

Same codebase, two changes:
- Run the server on the Mac (`npm start`), set `FORGE_URL =
  http://127.0.0.1:7860` (no tunnel).
- The join QR/`/join` target is the Mac's **LAN IP** (`http://192.168.x.x:PORT`);
  phones must be on the same network (a dedicated hotspot avoids corporate WiFi
  client-isolation).

## Recommended generation defaults

Forge with an **SDXL Lightning or LCM** checkpoint at **4–8 steps, CFG 1–2,
~768–896px, 4 candidates**, safety checker on, SD 1.5 as a fallback. Expect
~30–60s per SDXL image on Apple Silicon — which is why trivia fills the
generating interstitial. Generate candidates **sequentially** (`SEQUENTIAL_GEN`,
via `n_iter`) for lower peak memory. Verify the model/sampler/step combo on the
host machine the day before.

## Security & safety

- `/operator` and Settings are gated by `ADMIN_PASSWORD`.
- The tunnel makes Forge publicly reachable; the quick-tunnel URL is obscure and
  short-lived. For hardening, use ngrok basic-auth or Cloudflare Access and put
  the credential in `FORGE_AUTH_HEADER` (Settings).
- Keep `SAFETY_CHECKER` on and use an SFW checkpoint. The profanity filter and
  whole-word forbidden check run on every prompt; the operator has image-veto and
  score-override as human backstops.
