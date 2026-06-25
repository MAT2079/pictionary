# AI Pictionary — Operator Manual

Plain-language guide to running the show. Read once before the event.

---

## 1. One-time setup

1. **Deploy the server to Render** (free web service) using `render.yaml` (Render
   → New → Blueprint → point at this repo). It sets `OPERATOR_PASSWORD`
   (default `adminburger`) and generates `WORKER_SECRET`.
2. **Note your URL** (e.g. `https://ai-pictionary.onrender.com`) and the
   `WORKER_SECRET` (Render → your service → Environment, or read-only in the
   operator **Settings → Backend**).
3. **Set up the GPU machine** following:
   - Windows (primary): [`forge/forge-setup-windows.md`](../forge/forge-setup-windows.md)
   - macOS (backup): [`forge/forge-setup-mac.md`](../forge/forge-setup-mac.md)
4. *(Optional)* **Set up the Discord bot** ([`bot/README.md`](../bot/README.md))
   so you can start/stop the stack from your phone.
5. **Do a full dry run** end-to-end at least once on the actual hardware.

---

## 2. Showtime sequence

Run these in order, ~10 minutes before kickoff:

1. **Warm the Render app** — open the URL in a browser ~1 minute ahead (free
   services cold-start after idling; see §4). Optionally point a free
   [UptimeRobot](https://uptimerobot.com) monitor at it during the event so it
   never idles mid-game.
2. **Start the GPU stack** on the home machine:
   - via Discord: `/run https://your-app.onrender.com`, **or**
   - by hand: `cd forge && docker compose up -d` (Windows) / launch Forge +
     worker natively (macOS).
3. **Run the flight check**:
   - Windows: `cd forge; ./flight-check.ps1 -RenderUrl <url> -WorkerSecret <secret>`
   - macOS: `cd forge && ./flight-check.sh <url> <secret>`
   All steps should PASS (it ends by submitting a real test job).
4. **Open the Operator Console** at `/operator`, log in, and confirm
   **Settings → Backend** shows *worker online* with a recent last-poll time.
5. **Load the screens**:
   - Projector browser → `/present` (fullscreen). Shows the join QR.
   - Host machine browser → `/prompt` (Prompter Station).
   - Operator device → `/operator`.
6. **Show the QR** on the projector; champions scan it (one phone per team),
   name their team, and appear in the lobby.
7. In the Operator Console: set the **turn order**, then **Start game**.

### Running a turn

1. **Reveal** → press **Start compose timer**.
2. The prompting team types at the Prompter Station (forbidden words highlight
   live). They press **Generate image** (or the 60 s timer auto-submits the
   draft). You can **Extend** or **Skip** if needed.
3. **Generating** → trivia shows on the projector after 3 s. If it errors, press
   **Regenerate**.
4. **Picking** → the prompter taps an image. You can **Reject** any image
   (safety veto) or **Regenerate** with new seeds.
5. **Guessing** → champions guess on phones; the projector shows the image +
   countdown. You can accept/reject any team's guess live or **End guessing now**.
6. **Round reveal** → the answer + the verbatim prompt + who scored. Override any
   award here if you like, then **Next turn**.
7. After every team has prompted once → **Final scores**.

---

## 3. Fallback ladder (if something breaks)

Work top to bottom; each rung is a smaller dependency:

1. **Discord-controlled worker** — `/run`, `/status`, `/restart` from Discord.
2. **Manual worker start** — RDP/sit at the machine: `docker compose up -d`
   (Windows) or run the worker natively (macOS). Re-run the flight check.
3. **Cloudflare quick tunnel (tunnel mode)** — if the worker/poll path is
   misbehaving but Forge works, expose Forge with a quick tunnel and let the
   server call it directly:
   ```bash
   cloudflared tunnel --url http://localhost:7860
   ```
   Copy the printed `https://xxx.trycloudflare.com` URL into **Settings →
   Backend → Tunnel URL**, switch **Backend mode** to **tunnel**, and save.
   (Tunnel mode has no worker-side NSFW classifier; the curated pool, safety
   negative prompt, and your pick-grid veto remain the active safety layers.)
4. **All-local mode** — if Render or the venue internet fails entirely:
   - Run the server on the Mac: `npm install && npm run build && PORT=3000 BASE_URL=http://<MAC-LAN-IP>:3000 npm start`.
   - Run a local worker against `http://127.0.0.1:7860`.
   - The join QR now points at the LAN IP; have champions join the Mac's
     **hotspot/Wi-Fi**, then scan.

---

## 4. Cold start & keep-warm

Render free web services **spin down after ~15 minutes idle** and take ~1 minute
to cold-start. Warm the app ~1 minute before kickoff, and optionally keep an
UptimeRobot monitor pinging the URL during the event so it never idles between
turns.

---

## 5. In-memory state caveat

All game state and Settings live **in server memory** — there is no database.

- A Settings change (timers, scoring, even a password) applies **only for the
  running session**. After a Render **redeploy or spin-down**, values revert to
  their env vars / defaults.
- To make a change **permanent**, set the env var in Render (e.g.
  `OPERATOR_PASSWORD`), **or** re-import a **snapshot** after restart.
- Use **Settings → Game → Export snapshot** between your test days to save
  settings + pool + scores, and **Import snapshot** to restore them. Also
  **Export final scores** at the end for your records.

---

## 6. Safety (non-negotiable)

NSFW output is disallowed unconditionally — there is **no toggle anywhere**.
Safety is layered: the curated wholesome prompt pool (players never free-prompt),
an SFW checkpoint, a fixed safety negative prompt, the optional worker-side NSFW
image classifier, and your **reject/veto on the pick grid** as the final human
gate. If anything looks off, reject it.
