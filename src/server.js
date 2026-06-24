'use strict';

/*
 * AI Pictionary game server (spec §2, §3, §11, §12).
 *
 * Single Node process: Express serves the four+one browser UIs and a small REST
 * surface; `ws` keeps every client in sync. State lives in memory (state.js).
 * Binds 0.0.0.0:$PORT for Render.
 */

const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const config = require('./config');
const forge = require('./forge');
const validation = require('./validation');
const game = require('./state');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
if (!process.env.ADMIN_PASSWORD) {
  console.warn('[server] ADMIN_PASSWORD not set — defaulting to "changeme". Set it in production.');
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- Page routes ----------------------------------------------------------
const pages = {
  '/operator': 'operator.html',
  '/operator/settings': 'settings.html',
  '/play': 'play.html',
  '/present': 'present.html',
  '/join': 'join.html'
};
for (const [route, file] of Object.entries(pages)) {
  app.get(route, (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', file)));
}
app.get('/', (_req, res) => res.redirect('/present'));
app.get('/healthz', (_req, res) => res.json({ ok: true, phase: game.state.phase }));

// QR code for the join URL (used by the presentation lobby).
app.get('/api/qrcode', async (req, res) => {
  const text = String(req.query.text || '');
  try {
    const dataUrl = await QRCode.toDataURL(text, { width: 320, margin: 1 });
    res.json({ ok: true, dataUrl });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ---- Connection registry --------------------------------------------------
let connSeq = 0;
const clients = new Map(); // ws -> { connId, role, authed, teamId }

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

// ---- Role-aware state projection (spec §3, §8) ----------------------------
const PUBLIC_SETTINGS_KEYS = [
  'TRIVIA_DELAY_SECONDS', 'TRIVIA_ROTATE_SECONDS', 'MIRROR_IMAGE_TO_PHONES',
  'COMPOSE_SECONDS', 'PICK_SECONDS', 'GUESS_SECONDS'
];

function publicSettings() {
  const out = {};
  for (const k of PUBLIC_SETTINGS_KEYS) out[k] = config.get(k);
  return out;
}

function baseProjection() {
  const st = game.state;
  return {
    type: 'state',
    now: Date.now(),
    phase: st.phase,
    timer: st.timer,
    lobbyLocked: st.lobbyLocked,
    prompterTeamId: game.currentPrompterId(),
    turnNumber: st.currentTurnIndex + 1,
    totalTurns: st.turnOrder.length,
    teams: st.teams.map((t) => ({ id: t.id, name: t.name, score: t.score, connected: !!t.connId })),
    generation: st.generation,
    settings: publicSettings()
  };
}

function revealPayload() {
  // Shared SCORE reveal block (target + actual prompt + guesses + award).
  const st = game.state;
  if (!st.lastTurnResult) return null;
  const r = st.lastTurnResult;
  return {
    target: r.target,
    prompt: r.prompt,
    image: r.image,
    prompterTeamId: r.prompterTeamId,
    guesses: r.guesses,
    award: r.award,
    earliestTeamId: r.earliestTeamId,
    numCorrect: r.numCorrect
  };
}

function projectFor(meta) {
  const st = game.state;
  const base = baseProjection();
  base.role = meta.role;

  if (meta.role === 'operator' || meta.role === 'settings') {
    if (!meta.authed) return { type: 'needAuth' };
    return Object.assign(base, {
      authed: true,
      fullSettings: config.getSettings(),
      currentEntry: st.currentEntryId ? config.findPrompt(st.currentEntryId) : null,
      currentPrompt: st.currentPrompt,
      candidates: st.candidates,
      chosenImage: st.chosenImage,
      chosenIndex: st.chosenIndex,
      guesses: st.guesses,
      lastTurnResult: st.lastTurnResult,
      pool: game.poolStatus(),
      prompts: config.getPrompts(),
      trivia: config.getTrivia(),
      profanity: config.getProfanity(),
      draft: st._draft || ''
    });
  }

  if (meta.role === 'play') {
    const entry = st.currentEntryId ? config.findPrompt(st.currentEntryId) : null;
    return Object.assign(base, {
      target: entry ? entry.target : null,
      forbidden: entry ? entry.forbidden : [],
      currentPrompt: st.currentPrompt,
      // Candidate grid is only exposed during PICK.
      candidates: st.phase === game.PHASES.PICK ? st.candidates : [],
      chosenImage: st.chosenImage,
      chosenIndex: st.chosenIndex,
      lastTurnResult: st.lastTurnResult
    });
  }

  if (meta.role === 'present') {
    const out = Object.assign(base, {
      trivia: config.getTrivia()
    });
    // Chosen image is shown only during GUESS (and the SCORE reveal).
    if (st.phase === game.PHASES.GUESS) out.chosenImage = st.chosenImage;
    if (st.phase === game.PHASES.SCORE) out.reveal = revealPayload();
    return out;
  }

  // role === 'join' (champion phone)
  {
    const out = Object.assign(base, { teamId: meta.teamId || null });
    const myGuess = meta.teamId ? st.guesses[meta.teamId] : null;
    out.myGuess = myGuess || null;
    out.amPrompter = meta.teamId && meta.teamId === game.currentPrompterId();
    if (st.phase === game.PHASES.SCORE) {
      const r = revealPayload();
      out.reveal = r ? { target: r.target, prompterTeamId: r.prompterTeamId, award: r.award } : null;
    }
    if (config.get('MIRROR_IMAGE_TO_PHONES') && st.phase === game.PHASES.GUESS) {
      out.chosenImage = st.chosenImage;
    }
    return out;
  }
}

function broadcast() {
  for (const [ws, meta] of clients) {
    send(ws, projectFor(meta));
  }
}
game.setOnChange(broadcast);

// ---- WebSocket handling ---------------------------------------------------
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const role = (url.searchParams.get('role') || 'present').toLowerCase();
  const meta = { connId: `ws_${++connSeq}`, role, authed: false, teamId: null };
  clients.set(ws, meta);

  send(ws, projectFor(meta));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    handleMessage(ws, meta, msg);
  });

  ws.on('close', () => {
    // Keep the team in the roster (champions may reconnect); just detach conn.
    const team = game.teamByConn(meta.connId);
    if (team) { team.connId = null; broadcast(); }
    clients.delete(ws);
  });
});

function requireAdmin(meta, ws) {
  if (meta.authed) return true;
  send(ws, { type: 'error', message: 'Admin authentication required.' });
  return false;
}

function handleMessage(ws, meta, msg) {
  const type = msg.type;

  // ---- Auth (operator / settings) ----
  if (type === 'auth') {
    meta.authed = msg.password === ADMIN_PASSWORD;
    send(ws, { type: 'authResult', ok: meta.authed });
    if (meta.authed) send(ws, projectFor(meta));
    return;
  }

  // ---- Champion (open) ----
  if (type === 'join') {
    const r = game.addTeam(msg.name, meta.connId);
    if (r.ok) { meta.teamId = r.team.id; send(ws, { type: 'joined', teamId: r.team.id, name: r.team.name }); }
    else send(ws, { type: 'error', message: r.error });
    send(ws, projectFor(meta));
    return;
  }
  if (type === 'rejoin') {
    const t = game.attachConn(msg.teamId, meta.connId);
    if (t) { meta.teamId = t.id; send(ws, { type: 'joined', teamId: t.id, name: t.name }); }
    send(ws, projectFor(meta));
    return;
  }
  if (type === 'submitGuess') {
    const r = game.submitGuess(meta.connId, msg.text);
    send(ws, { type: 'guessResult', ...r });
    return;
  }

  // ---- Prompter station (open, host-side) ----
  if (type === 'draft') { game.setDraft(meta.connId, msg.text); return; }
  if (type === 'previewPrompt') {
    const entry = game.state.currentEntryId ? config.findPrompt(game.state.currentEntryId) : null;
    const p = validation.previewPrompt(msg.text, entry, config.getProfanity());
    send(ws, { type: 'previewResult', ...p });
    return;
  }
  if (type === 'submitPrompt') {
    const r = game.submitPrompt(meta.connId, msg.text);
    if (!r.ok && r.reason) send(ws, { type: 'promptRejected', ...r });
    else if (!r.ok) send(ws, { type: 'error', message: r.error });
    else send(ws, { type: 'promptAccepted', clean: r.clean });
    return;
  }
  if (type === 'pickImage') {
    const r = game.pickImage(meta.connId, msg.index);
    if (!r.ok) send(ws, { type: 'error', message: r.error });
    return;
  }

  // ---- Operator / Settings (admin-gated below this line) ----
  const adminOps = new Set([
    'startGame', 'advancePhase', 'nextTurn', 'skipTurn', 'endGame', 'vetoRegenerate',
    'retryGeneration', 'acceptGuess', 'overrideScore', 'lockLobby', 'updateSettings',
    'testConnection', 'listModels', 'upsertPrompt', 'removePrompt', 'resetUsed',
    'upsertTrivia', 'removeTrivia', 'setProfanity', 'exportSettings', 'importSettings',
    'exportScores'
  ]);
  if (!adminOps.has(type)) return;
  if (!requireAdmin(meta, ws)) return;

  switch (type) {
    case 'startGame': reply(ws, type, game.startGame()); break;
    case 'advancePhase': reply(ws, type, game.advancePhase()); break;
    case 'nextTurn': reply(ws, type, game.nextTurn()); break;
    case 'skipTurn': reply(ws, type, game.skipTurn()); break;
    case 'endGame': reply(ws, type, game.endGame()); break;
    case 'vetoRegenerate': reply(ws, type, game.vetoRegenerate()); break;
    case 'retryGeneration': reply(ws, type, game.retryGeneration()); break;
    case 'acceptGuess': reply(ws, type, game.acceptGuess(msg.teamId)); break;
    case 'overrideScore': reply(ws, type, game.overrideScore(msg.teamId, msg.score)); break;
    case 'lockLobby': game.setLobbyLocked(msg.locked); reply(ws, type, { ok: true }); break;

    case 'updateSettings':
      config.updateSettings(msg.patch || {});
      reply(ws, type, { ok: true });
      broadcast();
      break;

    case 'testConnection':
      forge.testConnection(config.getSettings()).then((res) => {
        send(ws, { type: 'opResult', op: 'testConnection', ...res });
      });
      break;

    case 'listModels':
      forge.listModels(config.getSettings()).then((res) => {
        send(ws, { type: 'opResult', op: 'listModels', ...res });
      });
      break;

    case 'upsertPrompt': config.upsertPrompt(msg.entry); reply(ws, type, { ok: true }); broadcast(); break;
    case 'removePrompt': config.removePrompt(msg.id); reply(ws, type, { ok: true }); broadcast(); break;
    case 'resetUsed': config.resetUsedFlags(); reply(ws, type, { ok: true }); broadcast(); break;
    case 'upsertTrivia': config.upsertTrivia(msg.item); reply(ws, type, { ok: true }); broadcast(); break;
    case 'removeTrivia': config.removeTrivia(msg.id); reply(ws, type, { ok: true }); broadcast(); break;
    case 'setProfanity': config.setProfanity(msg.list); reply(ws, type, { ok: true }); broadcast(); break;

    case 'exportSettings':
      send(ws, { type: 'opResult', op: 'exportSettings', settings: config.getSettings(),
        prompts: config.getPrompts(), trivia: config.getTrivia(), profanity: config.getProfanity() });
      break;
    case 'importSettings':
      if (msg.data) {
        if (msg.data.settings) config.importSettings(msg.data.settings);
        if (Array.isArray(msg.data.prompts)) config.setPrompts(msg.data.prompts);
        if (Array.isArray(msg.data.trivia)) msg.data.trivia.forEach((t) => config.upsertTrivia(t));
        if (Array.isArray(msg.data.profanity)) config.setProfanity(msg.data.profanity);
      }
      reply(ws, type, { ok: true });
      broadcast();
      break;
    case 'exportScores':
      send(ws, { type: 'opResult', op: 'exportScores',
        scores: game.state.teams.map((t) => ({ name: t.name, score: t.score })) });
      break;
  }
}

function reply(ws, op, result) {
  if (result && result.ok === false) send(ws, { type: 'error', message: result.error || 'Action failed.' });
  else send(ws, { type: 'opResult', op, ...result });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AI Pictionary server listening on 0.0.0.0:${PORT}`);
  console.log(`  Operator   /operator   (password gated)`);
  console.log(`  Settings   /operator/settings`);
  console.log(`  Prompter   /play`);
  console.log(`  Present    /present`);
  console.log(`  Join       /join`);
});
