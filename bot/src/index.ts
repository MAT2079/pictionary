import 'dotenv/config';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';

// Discord control bot (spec §20). Native on the Windows host. Outbound-only:
// Discord gateway + the same cloud server the worker polls. It is a convenience
// layer — the stack must remain startable by hand without it.

const execAsync = promisify(exec);

const TOKEN = required('DISCORD_TOKEN');
const GUILD_ID = required('GUILD_ID');
const ALLOWED_USER_ID = required('ALLOWED_USER_ID');
const COMPOSE_DIR = process.env.COMPOSE_DIR ?? process.cwd();
const COMPOSE_FILE = join(COMPOSE_DIR, 'docker-compose.yml');
const ENV_FILE = join(COMPOSE_DIR, '.env');
const RENDER_HEALTH_DEFAULT = process.env.RENDER_URL ?? '';

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[bot] missing required env ${name}`);
    process.exit(1);
  }
  return v;
}

const compose = (args: string) => `docker compose -f "${COMPOSE_FILE}" ${args}`;

async function run(cmd: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd: COMPOSE_DIR, timeout: 120_000, maxBuffer: 1024 * 1024 });
    return (stdout + (stderr ? `\n${stderr}` : '')).trim() || '(no output)';
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    return `ERROR: ${(e.stderr || e.stdout || e.message).trim()}`;
  }
}

/** Persist RENDER_URL (and pass-through secret) into the compose .env so the
 *  worker container picks it up. Preserves any existing keys. */
function writeRenderUrl(renderUrl: string): void {
  const lines = new Map<string, string>();
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) lines.set(m[1], m[2]);
    }
  }
  lines.set('RENDER_URL', renderUrl);
  if (process.env.WORKER_SECRET) lines.set('WORKER_SECRET', process.env.WORKER_SECRET);
  const out = [...lines.entries()].map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  writeFileSync(ENV_FILE, out);
}

function clip(text: string, max = 1800): string {
  return text.length > max ? text.slice(0, max) + '\n…(truncated)' : text;
}

const commands = [
  new SlashCommandBuilder().setName('run').setDescription('Start the Forge + worker stack')
    .addStringOption((o) => o.setName('render_url').setDescription('Cloud server base URL the worker polls')),
  new SlashCommandBuilder().setName('stop').setDescription('Stop the stack (compose down)'),
  new SlashCommandBuilder().setName('status').setDescription('Show stack + server + Forge status'),
  new SlashCommandBuilder().setName('logs').setDescription('Tail service logs')
    .addStringOption((o) => o.setName('service').setDescription('forge | worker'))
    .addIntegerOption((o) => o.setName('lines').setDescription('How many lines (default 40)')),
  new SlashCommandBuilder().setName('restart').setDescription('Restart the stack'),
].map((c) => c.toJSON());

async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const appId = Buffer.from(TOKEN.split('.')[0], 'base64').toString();
  await rest.put(Routes.applicationGuildCommands(appId, GUILD_ID), { body: commands });
  console.log('[bot] slash commands registered to guild', GUILD_ID);
}

async function handle(i: ChatInputCommandInteraction): Promise<void> {
  if (i.user.id !== ALLOWED_USER_ID) {
    await i.reply({ content: 'Not authorized.', ephemeral: true });
    return;
  }
  await i.deferReply();

  switch (i.commandName) {
    case 'run': {
      const renderUrl = i.options.getString('render_url') ?? RENDER_HEALTH_DEFAULT;
      if (renderUrl) writeRenderUrl(renderUrl);
      const out = await run(compose('up -d'));
      await i.editReply(`**Started** (RENDER_URL=${renderUrl || 'from .env'})\n\`\`\`\n${clip(out)}\n\`\`\``);
      break;
    }
    case 'stop': {
      const out = await run(compose('down'));
      await i.editReply(`**Stopped**\n\`\`\`\n${clip(out)}\n\`\`\``);
      break;
    }
    case 'restart': {
      await run(compose('down'));
      const out = await run(compose('up -d'));
      await i.editReply(`**Restarted**\n\`\`\`\n${clip(out)}\n\`\`\``);
      break;
    }
    case 'logs': {
      const service = i.options.getString('service') ?? '';
      const lines = i.options.getInteger('lines') ?? 40;
      const out = await run(compose(`logs --tail ${lines} ${service}`.trim()));
      await i.editReply(`**Logs** ${service || '(all)'}\n\`\`\`\n${clip(out)}\n\`\`\``);
      break;
    }
    case 'status': {
      const ps = await run(compose('ps'));
      let server = 'RENDER_URL not set';
      let forge = '—';
      const renderUrl = RENDER_HEALTH_DEFAULT;
      if (renderUrl) {
        server = await probe(`${renderUrl.replace(/\/+$/, '')}/worker/health`);
      }
      forge = await probe(`${(process.env.FORGE_URL ?? 'http://localhost:7860').replace(/\/+$/, '')}/sdapi/v1/sd-models`);
      await i.editReply(
        `**Stack**\n\`\`\`\n${clip(ps, 1200)}\n\`\`\`\n` +
        `**Server /worker/health:** ${server}\n**Forge:** ${forge}`,
      );
      break;
    }
  }
}

async function probe(url: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return res.ok ? `🟢 ${res.status}` : `🟠 ${res.status}`;
  } catch (e) {
    return `🔴 unreachable (${(e as Error).message})`;
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => console.log(`[bot] logged in as ${client.user?.tag}`));
client.on('interactionCreate', (interaction) => {
  if (interaction.isChatInputCommand()) handle(interaction).catch((e) => console.error('[bot]', e));
});

await registerCommands();
await client.login(TOKEN);
