import type { Server as HttpServer } from 'node:http';
import { Server as IOServer, Socket } from 'socket.io';
import { state, getTeamByToken, touch } from './state.js';
import { bus, Events } from './bus.js';
import { getBatchImages, getChosenImage, getLastJobError, setLatestDraft, submitGuess } from './stateMachine.js';
import { forbiddenHits } from './validation.js';
import { getLastPollAt } from './jobs.js';
import { verifySession } from './auth.js';
import type { Role } from './types.js';

/** Pull a named cookie out of a raw Cookie header. */
function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

let io: IOServer;

interface SocketData {
  role: Role;
  teamId?: string;
}

/** Public, always-safe team summary (no secrets). */
function publicTeams() {
  return state.teams.map((t) => ({
    id: t.id,
    name: t.name,
    score: t.score,
    connected: t.connected,
    hasPrompted: t.hasPrompted,
  }));
}

function workerHealth() {
  const lastPollAt = getLastPollAt();
  return { lastPollAt, online: lastPollAt > 0 && Date.now() - lastPollAt < 60_000 };
}

/**
 * Build the state payload for a given role (spec §12.3 redaction rule):
 * the server must NEVER send target / forbidden / prompt text to guessing
 * phones or the presentation view before roundReveal. Only the Prompter Station
 * receives the target/forbidden list, and only during its own turn.
 */
export function serializeFor(role: Role, teamId?: string) {
  const turn = state.currentTurn;
  const prompterTeam = turn ? state.teams.find((t) => t.id === turn.promptingTeamId) : undefined;
  const atOrAfterReveal = state.phase === 'roundReveal' || state.phase === 'finalScores';

  const base: Record<string, unknown> = {
    phase: state.phase,
    teams: publicTeams(),
    turnOrder: state.turnOrder,
    currentTurnIndex: state.currentTurnIndex,
    timer: state.timer ?? null,
    prompterTeamId: turn?.promptingTeamId ?? null,
    prompterTeamName: prompterTeam?.name ?? null,
  };

  // --- Operator: full visibility (drives the dense control surface) ---
  if (role === 'operator') {
    return {
      ...base,
      settings: state.settings,
      worker: workerHealth(),
      workerSecret: process.env.WORKER_SECRET ?? '', // read-only view in Settings
      jobError: getLastJobError() ?? null,
      reveal: turn ? { target: turn.entry.target, forbidden: turn.entry.forbidden, category: turn.entry.category } : null,
      prompt: turn?.prompt ?? null,
      images: state.phase === 'picking' ? getBatchImages() : [],
      chosenImage: getChosenImage() ?? null,
      chosenImageIndex: turn?.chosenImageIndex ?? null,
      guesses: turn?.guesses ?? [],
      awarded: turn?.awarded ?? null,
    };
  }

  // --- Prompter Station: target/forbidden for the current turn only ---
  if (role === 'prompter') {
    return {
      ...base,
      reveal: turn ? { target: turn.entry.target, forbidden: turn.entry.forbidden, category: turn.entry.category } : null,
      // prompt/images relevant to the host composing + picking
      prompt: turn?.prompt ?? null,
      images: state.phase === 'picking' ? getBatchImages() : [],
      chosenImage: getChosenImage() ?? null,
      chosenImageIndex: turn?.chosenImageIndex ?? null,
      maxPromptLength: state.settings.maxPromptLength,
    };
  }

  // --- Presentation: projector; nothing secret before roundReveal ---
  if (role === 'present') {
    return {
      ...base,
      // The chosen image is shown during guessing; never the target/prompt.
      chosenImage: state.phase === 'guessing' || state.phase === 'roundReveal' ? getChosenImage() ?? null : null,
      // Only at/after reveal do target + verbatim prompt become public.
      reveal: atOrAfterReveal && turn ? { target: turn.entry.target } : null,
      prompt: atOrAfterReveal ? turn?.prompt ?? null : null,
    };
  }

  // --- Phone: JSON only, never images, never target/prompt ---
  const me = teamId ? state.teams.find((t) => t.id === teamId) : undefined;
  return {
    ...base,
    you: me
      ? {
          teamId: me.id,
          name: me.name,
          score: me.score,
          hasPrompted: me.hasPrompted,
          isPrompter: turn?.promptingTeamId === me.id,
          alreadyCorrect: !!turn?.guesses.some((g) => g.teamId === me.id && g.correct),
        }
      : null,
  };
}

function emitStateToAll(): void {
  for (const [, socket] of io.sockets.sockets) {
    const data = socket.data as SocketData;
    socket.emit('state:update', serializeFor(data.role, data.teamId));
  }
}

export function setupSockets(server: HttpServer): IOServer {
  io = new IOServer(server, {
    cors: { origin: true, credentials: true },
  });

  io.on('connection', (socket: Socket) => {
    const q = socket.handshake.query;
    let role = (typeof q.role === 'string' ? q.role : 'present') as Role;
    const token = typeof q.token === 'string' ? q.token : undefined;

    // The operator full-state view (targets, secret, batch images) must require
    // a valid operator session. Without one, downgrade to the redacted present
    // view so secrets never leak to a client that merely claims role=operator.
    if (role === 'operator') {
      const session = readCookie(socket.handshake.headers.cookie, 'op_session');
      if (!verifySession(session)) role = 'present';
    }

    const data: SocketData = { role };
    if (role === 'phone' && token) {
      const team = getTeamByToken(token);
      if (team) {
        data.teamId = team.id;
        team.championSocketId = socket.id;
        team.connected = true;
        touch();
      }
    }
    socket.data = data;
    socket.join(role);

    // Initial state.
    socket.emit('state:update', serializeFor(data.role, data.teamId));

    // Live forbidden-word highlighting (spec §12.3). Server returns hits and,
    // for the prompter, records the latest draft for compose-expiry validation.
    socket.on('prompt:keystroke', (payload: { draft?: string }) => {
      const draft = String(payload?.draft ?? '');
      const turn = state.currentTurn;
      if (data.role === 'prompter' && state.phase === 'compose') {
        setLatestDraft(draft);
      }
      const hits = turn ? forbiddenHits(draft, turn.entry.forbidden) : [];
      socket.emit('prompt:hits', { hits });
    });

    // Phone guess via socket (REST /api/guess also supported).
    socket.on('guess:submit', (payload: { token?: string; text?: string }) => {
      const team = payload?.token ? getTeamByToken(payload.token) : data.teamId ? state.teams.find((t) => t.id === data.teamId) : undefined;
      if (!team) {
        socket.emit('guess:ack', { accepted: false, reason: 'unknown-team' });
        return;
      }
      const outcome = submitGuess(team.id, String(payload?.text ?? ''));
      socket.emit('guess:ack', outcome);
    });

    socket.on('disconnect', () => {
      if (data.teamId) {
        const team = state.teams.find((t) => t.id === data.teamId);
        if (team && team.championSocketId === socket.id) {
          team.connected = false;
          touch();
        }
      }
    });
  });

  // --- Subscribe to game-logic events and fan out with redaction ---
  bus.on(Events.StateChanged, emitStateToAll);

  bus.on(Events.TimerTick, (tick) => {
    io.emit('timer:tick', tick);
  });

  bus.on(Events.ImagesReady, (payload) => {
    // Images go only to the prompter (pick grid) and operator. Never phones.
    io.to('prompter').emit('images:ready', payload);
    io.to('operator').emit('images:ready', payload);
  });

  bus.on(Events.TriviaShow, (payload) => {
    io.to('present').emit('trivia:show', payload);
    io.to('operator').emit('trivia:show', payload);
  });

  bus.on(Events.RoundReveal, (payload) => {
    io.to('present').emit('round:reveal', payload);
    io.to('operator').emit('round:reveal', payload);
    io.to('prompter').emit('round:reveal', payload);
  });

  return io;
}
