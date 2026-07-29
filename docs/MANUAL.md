# AI Pictionary — Operator Manual (Runware variant)

Plain-language guide to running the show. Read once before the event. This
variant generates images through the **Runware API**, so there is **no GPU
machine, no worker, no Forge, and no flight check** — just the cloud app.

---

## 1. One-time setup

1. **Get a Runware API key** — sign up at <https://my.runware.ai> → **API Keys**,
   create one, and note it. (Runware is pay-as-you-go; check your credit/billing.)
2. **Deploy the server to Render** (free web service) using `render.yaml` (Render
   → New → Blueprint → point at this repo). It sets `OPERATOR_PASSWORD` (default
   `adminburger`). In the service's **Environment**, set **`RUNWARE_API_KEY`** to
   your key (it's marked `sync:false`, so it's never committed).
3. **Note your URL** (e.g. `https://ai-pictionary-runware.onrender.com`).
4. **Open `/operator`**, log in, go to **Settings → Backend — Runware**:
   - Confirm status shows **🟢 API key configured**.
   - Set the **Model AIR** (default `runware:100@1`; browse
     <https://my.runware.ai/models>). Tune **Image generation** params to suit
     the model (fewer steps for a Lightning model).
   - Click **Test generation** — you should get images back.
5. **Do a full dry run** end-to-end at least once.

---

## 2. Showtime sequence

Run these ~5 minutes before kickoff:

1. **Warm the Render app** — open the URL ~1 minute ahead (free services
   cold-start after idling; see §4). Optionally point a free
   [UptimeRobot](https://uptimerobot.com) monitor at it during the event.
2. **Open the Operator Console** at `/operator`, log in, and confirm **Settings →
   Backend — Runware** shows the key configured (and **Test generation** works).
3. **Load the screens**:
   - Projector browser → `/present` (fullscreen). Shows the join QR.
   - Host machine browser → `/prompt` (Prompter Station).
   - Operator device → `/operator`.
4. **Show the QR** on the projector; champions scan it (one phone per team),
   name their team, and appear in the lobby.
5. In the Operator Console: set the **turn order**, then **Start game**.

### Running a turn

1. **Reveal** → press **Start compose timer**.
2. The prompting team types at the Prompter Station (forbidden words highlight
   live). They press **Generate image** (or the 60 s timer auto-submits). You can
   **Extend** or **Skip**.
3. **Generating** → the server calls Runware; trivia shows on the projector after
   3 s. If it errors, press **Regenerate**.
4. **Picking** → the prompter taps an image. You can **Reject** any image (safety
   veto) or **Regenerate** with new seeds.
5. **Guessing** → champions guess on phones; the projector shows the image +
   countdown. Accept/reject any team's guess live or **End guessing now**.
6. **Round reveal** → the answer + the verbatim prompt + who scored. Override any
   award, then **Next turn**.
7. After every team has prompted once → **Final scores**.

---

## 3. If something goes wrong

There's no local stack to fall back to — the dependency is the Runware API. If a
generation fails or looks off:

- **Regenerate** on the pick grid (new seeds).
- **Skip** the turn if it keeps failing.
- Check **Settings → Backend — Runware → Test generation**. If it fails:
  - The **API key** may be missing/invalid, or your Runware **credit** is
    exhausted — check <https://my.runware.ai>.
  - The **Model AIR** may be wrong — pick another from my.runware.ai/models.
  - Try a **smaller batch size** or **fewer steps** if requests time out.
- Remember: an in-memory `RUNWARE_API_KEY` override in Settings is session-only;
  the permanent value is the Render env var.

---

## 4. Cold start & keep-warm

Render free web services **spin down after ~15 minutes idle** and take ~1 minute
to cold-start. Warm the app ~1 minute before kickoff, and optionally keep an
UptimeRobot monitor pinging the URL during the event so it never idles between
turns.

---

## 5. In-memory state caveat

All game state and Settings live **in server memory** — there is no database.

- A Settings change (timers, scoring, model, even the password) applies **only
  for the running session**. After a Render **redeploy or spin-down**, values
  revert to their env vars / defaults.
- Make changes permanent via Render env vars (e.g. `OPERATOR_PASSWORD`,
  `RUNWARE_API_KEY`), **or** re-import a **snapshot** after restart.
- Use **Settings → Game → Export snapshot** to save settings + pool + scores, and
  **Import snapshot** to restore. **Export final scores** at the end for records.

---

## 6. Safety (non-negotiable)

NSFW output is disallowed unconditionally — there is **no toggle anywhere**.
Layered: the curated wholesome prompt pool (players never free-prompt), the fixed
safety negative prompt, Runware's `checkNSFW` (flagged images are auto-dropped
server-side), and your **reject/veto on the pick grid** as the final human gate.
If anything looks off, reject it.
