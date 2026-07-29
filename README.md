# AI Pictionary — Runware variant (`test1`)

A party game for an office event. Teams elect a **champion**; each team prompts
once. The prompter sees a secret target word + a forbidden list and has 60 s to
write a text-to-image prompt that evokes it without any forbidden word. The
prompt is sent to the **[Runware](https://runware.ai) image API**; the prompter
picks one of the returned images; it's projected; other teams guess from their
phones; points are scored. After every team has prompted, a final scoreboard is
shown.

> **What's different from the main build:** this branch **removes the entire
> local-GPU pipeline** — the poll-worker, the Forge backend, the Discord control
> bot, and all their setup/flight-check scripts — and replaces image generation
> with a direct **server → Runware API** call. There is nothing to run on your
> own machine and no GPU required. **NSFW remains disallowed unconditionally**
> (curated pool + safety negative prompt + Runware `checkNSFW` + operator veto).

---

## Architecture

```
Phones ─┐
Projector ─┤  HTTPS / WebSocket   ┌──────────────────────────────┐
Prompter ─┼────────────────────► │ Render free web service       │
Operator ─┘                      │  Node/TS: REST + Socket.IO    │
                                 │  serves built React (4 views) │
                                 │  in-memory GameState          │
                                 │            │ HTTPS            │
                                 │            ▼                  │
                                 │   Runware image API           │
                                 └──────────────────────────────┘
```

Key invariants (unchanged): the server is the only component; **all timers are
server-authoritative**; state is in memory (no DB); image URLs flow Runware →
server → presentation/prompter only (phones get JSON). The only outbound
dependency is the Runware API.

---

## Quickstart (local dev)

Requires **Node 20+** and a **Runware API key** (create one at
<https://my.runware.ai> → API Keys).

```bash
npm install

# Terminal 1 — server (REST + Socket.IO) on :3000
RUNWARE_API_KEY=your-key npm run dev:server

# Terminal 2 — web (Vite dev server on :5173, proxies API/socket to :3000)
npm run dev:web
```

Open <http://localhost:5173> and pick a surface, or go straight to a view:
`/play` (phone), `/present` (projector), `/prompt` (host), `/operator`
(password `adminburger` by default). In **Operator → Settings → Backend —
Runware**, set the model AIR and hit **Test generation** to confirm the key works.

### Production build (what Render runs)

```bash
npm run build   # builds web/ (Vite) then server/ (tsc)
npm start       # node server/dist/index.js, binds 0.0.0.0:$PORT, serves web/dist
```

---

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `PORT` | Render-injected | binds `0.0.0.0` |
| `OPERATOR_PASSWORD` | `adminburger` | gate for Operator Console + Settings |
| `RUNWARE_API_KEY` | — | **required**; Bearer key for the Runware API. Never sent to the browser. |
| `BASE_URL` | derived from request | override for all-local/LAN mode so the join QR is correct |

**Runtime settings** (Runware model/scheduler, gen params, timers, scoring, pool,
trivia, profanity) are mutable in the password-gated **Settings** panel, held in
memory, and included in snapshots. In-memory values revert to env/defaults after
a Render redeploy or spin-down — export a snapshot to persist.

---

## Runware configuration

In **Operator → Settings → Backend — Runware**:

- **Model AIR** — the Runware model identifier (default `runware:100@1`, a general
  SDXL). Browse options at <https://my.runware.ai/models> and paste the AIR.
- **Scheduler** — optional; blank uses the model default.
- **API key override** — session-only; normally leave blank and use the
  `RUNWARE_API_KEY` env var. The key is never returned to the browser.
- **Test generation** — submits a benign prompt and reports whether images came
  back.

**Image generation** params (steps, CFG, width/height, batch size → Runware
`numberResults`, seed mode) are tuned per model in the same panel. Defaults are
generalist SDXL values (25 steps, CFG 6.5, 1024²); lower steps for a Lightning
model.

Each request sends `checkNSFW: true`; any image Runware flags is dropped before
it reaches the pick grid.

---

## Repository layout

```
.
├─ render.yaml                 # Render Blueprint (single free web service)
├─ package.json                # npm workspaces (server, web) + scripts
├─ server/                     # cloud game server (Express + Socket.IO)
│  ├─ src/                     # state, stateMachine, scoring, validation, pool,
│  │                           #   trivia, jobs, runware, http, sockets, auth, snapshot, index
│  └─ data/                    # prompts.example.yaml, trivia.example.yaml, profanity.txt
├─ web/                        # Vite + React + Tailwind frontend (4 views)
│  └─ src/views/{Phone,Present,Prompter,Operator}/
└─ docs/MANUAL.md              # operator runbook
```

There is no `worker/`, `forge/`, or `bot/` in this variant.

---

## Game rules quick reference

- **Validation** (server-side, in order): length ≤ 300 → silent charset sanitize
  (`[A-Za-z\s,'-]`, strips weighting/LoRA syntax) → forbidden words (whole-word,
  reports the offending term) → profanity (whole-word, generic message).
- **Guess matching**: normalized equality against `acceptedGuesses`; optional
  `fuzzyGuessing` allows Levenshtein ≤ 1; operator can always override.
- **Scoring**: each solving team `+100`; the single first correct `+50` more; the
  prompting team `+50 × (teams that solved)` — and **0 if nobody solved**. All
  values configurable; all awards operator-overridable.

## Safety

Layered, none user-flippable: curated SFW pool → fixed safety negative prompt →
Runware `checkNSFW` auto-drop → operator pick-grid veto. There is no flag,
setting, or env var that disables safety.
