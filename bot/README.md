# AI Pictionary — Discord Control Bot

A small convenience bot that lets the operator start/stop the local Forge + worker
stack from Discord, without RDP-ing into the home machine. It is **outbound-only**
(Discord gateway + the cloud server's health endpoint) and shells out to
`docker compose`. The stack is always startable by hand without it.

## Commands (restricted to `ALLOWED_USER_ID`)

| Command | What it does |
|---|---|
| `/run [render_url]` | Writes `RENDER_URL` into the compose `.env`, then `docker compose up -d`. |
| `/stop` | `docker compose down`. |
| `/restart` | `down` then `up -d`. |
| `/status` | `docker compose ps` + probes the server `/worker/health` and Forge `/sdapi/v1/sd-models`. |
| `/logs [service] [lines]` | Tails container logs (default 40 lines; service = `forge` or `worker`). |

## Setup

1. Create an application + bot at <https://discord.com/developers/applications>.
   Enable no privileged intents (only `Guilds` is used). Invite it to your guild
   with the `applications.commands` and `bot` scopes.
2. `cp .env.example .env` and fill in `DISCORD_TOKEN`, `GUILD_ID`,
   `ALLOWED_USER_ID`, `COMPOSE_DIR` (the repo's `forge/` folder), and optionally
   `RENDER_URL` / `WORKER_SECRET`.
3. Install + run:
   ```bash
   npm install
   npm run build
   npm start
   ```
   Slash commands register to your single guild on boot (near-instant, unlike
   global commands).

## Notes

- `COMPOSE_DIR` must contain `docker-compose.yml` (the `forge/docker-compose.yml`
  from this repo). The bot writes/updates a sibling `.env` there.
- Docker Desktop must be running on the host for the compose commands to work.
- The bot needs `docker` on its `PATH`.
