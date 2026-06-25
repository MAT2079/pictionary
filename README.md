# AI Pictionary

A party game for an office event. Teams elect a **champion**; each team prompts
once. The prompter sees a secret target word + a forbidden list and has 60 s to
write a text-to-image prompt that evokes it without any forbidden word. The
prompt goes to a Stable Diffusion **Forge** backend; the prompter picks an image;
it's projected; other teams guess from their phones; points are scored. After
every team has prompted, a final scoreboard is shown.

The cloud server is the only publicly reachable component. The GPU runs on the
operator's own machine and reaches the cloud through an **outbound-only**
poll-worker (never an inbound tunnel). **NSFW is disallowed unconditionally with
no toggle anywhere.**

> **Repo layout note:** the spec describes an `ai-pictionary/` root folder. This
> repository *is* that root — the workspaces (`server/`, `web/`, `worker/`,
> `bot/`, `forge/`, `docs/`) live directly here rather than nested one level
> deeper. This was the simplest choice and changes nothing functionally.

---

## Architecture

```
Phones ─┐
Projector ─┤  HTTPS / WebSocket   ┌────────────────────────────┐
Prompter ─┼────────────────────► │ Render free web service     │
Operator ─┘                      │  Node/TS: REST + Socket.IO  │
                                 │  serves built React (4 views)│
                                 │  in-memory GameState, jobs   │
                                 └─────────────▲───────────────┘
                                   outbound long-poll + upload
                                   (Bearer WORKER_SECRET)
                                 ┌─────────────┴───────────────┐
   Operator's machine           │ Poll-worker (Node/TS)       │
   (home Windows, primary)      │  pulls jobs → Forge → JPEGs │
                                 │            → http://forge   │
                                 │ Forge (--api) · SDXL Light. │
                                 └─────────────────────────────┘
   Discord bot (native) ──controls──► docker compose up/down/status
```

Key invariants: server is the only public component; worker/Forge/bot are
outbound-only; **all timers are server-authoritative**; state is in memory (no
DB); image bytes flow Forge → worker → server → presentation/prompter only
(phones get JSON).

---

## Quickstart (local dev)

Requires **Node 20+**.

```bash
npm install                 # installs all workspaces

# Terminal 1 — server (REST + Socket.IO + worker endpoints) on :3000
npm run dev:server

# Terminal 2 — web (Vite dev server on :5173, proxies API/socket to :3000)
npm run dev:web

# Terminal 3 — worker (needs a running Forge; see forge/ guides)
RENDER_URL=http://localhost:3000 WORKER_SECRET=dev-worker-secret \
FORGE_URL=http://127.0.0.1:7860 npm run dev:worker
```

Open <http://localhost:5173> and pick a surface, or go straight to a view:
`/play` (phone), `/present` (projector), `/prompt` (host), `/operator`
(password: `adminburger` by default).

### Production build (what Render runs)

```bash
npm run build   # builds web/ (Vite) then server/ (tsc)
npm start       # node server/dist/index.js, binds 0.0.0.0:$PORT, serves web/dist
```

---

## Environment variables

| Var | Where | Default | Notes |
|---|---|---|---|
| `PORT` | server | Render-injected | binds `0.0.0.0` |
| `OPERATOR_PASSWORD` | server | `adminburger` | gate for Operator Console + Settings |
| `WORKER_SECRET` | server | Blueprint-generated | Bearer token for `/worker/*`; view-only in Settings |
| `BASE_URL` | server | derived from request | override for all-local/LAN mode so the QR is correct |
| `RENDER_URL` | worker/bot | — | cloud server base URL the worker polls |
| `FORGE_URL` | worker | `http://forge:7860` (win) / `http://127.0.0.1:7860` (mac) | local only |
| `NSFW_REGEN_ATTEMPTS` | worker | `2` | regen flagged images N times, then drop |
| `JPEG_QUALITY` | worker | `82` | sharp JPEG quality |
| `DISCORD_TOKEN`,`GUILD_ID`,`ALLOWED_USER_ID`,`COMPOSE_DIR` | bot | — | see `bot/.env.example` |

**Runtime settings** (timers, scoring, gen params, pool, trivia, profanity,
backend mode) are mutable in the password-gated **Settings** panel, held in
memory, and included in snapshots. Because state is in memory, a value changed in
Settings reverts to its env/default after a Render redeploy or spin-down — see
[`docs/MANUAL.md`](docs/MANUAL.md).

---

## Repository layout

```
.
├─ render.yaml                 # Render Blueprint (single free web service)
├─ package.json                # npm workspaces + root scripts
├─ server/                     # cloud game server (Express + Socket.IO)
│  ├─ src/                     # state, stateMachine, scoring, validation, pool,
│  │                           #   trivia, jobs, forgeDirect, http, sockets,
│  │                           #   auth, snapshot, index
│  └─ data/                    # prompts.example.yaml, trivia.example.yaml, profanity.txt
├─ web/                        # Vite + React + Tailwind frontend (4 views)
│  └─ src/views/{Phone,Present,Prompter,Operator}/
├─ worker/                     # outbound poll-worker (+ Dockerfile, NSFW hook)
├─ bot/                        # Discord control bot
├─ forge/                      # docker-compose, forge.Dockerfile, setup guides,
│                              #   flight-check.ps1 / flight-check.sh, models/
└─ docs/MANUAL.md              # operator runbook
```

To use custom content, copy `server/data/prompts.example.yaml` →
`server/data/prompts.yaml` and `trivia.example.yaml` → `trivia.yaml`, or edit
live in the Settings panel.

---

## Game rules quick reference

- **Validation** (server-side, in order): length ≤ 300 → silent charset sanitize
  (`[A-Za-z\s,'-]`, which strips weighting/LoRA syntax) → forbidden words
  (whole-word, reports the offending term) → profanity (whole-word, generic
  message).
- **Guess matching**: normalized equality against `acceptedGuesses`; optional
  `fuzzyGuessing` allows Levenshtein ≤ 1; operator can always override.
- **Scoring**: each solving team `+100`; the single first correct `+50` more; the
  prompting team `+50 × (teams that solved)` — and **0 if nobody solved** (the
  central incentive). All values configurable; all awards operator-overridable.

---

## Design

The frontend uses a deliberate "late-night studio" aesthetic — deep ink
background, an electric-violet accent with mint/coral/gold supporting colors, the
Space Grotesk display face on an intentional oversized type scale for projector
legibility, and motion used sparingly (countdown rings, fade-ups, pulse). The
four views are responsive and degrade gracefully on reconnect.

## Safety

See spec §19 and `docs/MANUAL.md` §6. Layered, none user-flippable: curated SFW
pool → SFW checkpoint → fixed safety negative prompt → optional worker NSFW
classifier → operator pick-grid veto. There is no flag, setting, or env var that
disables safety.
