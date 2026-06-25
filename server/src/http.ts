import { Router, type Request, type Response } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { state, addTeam, getTeamByToken, getTeamByName, getTeamById, setSettings, resetGame } from './state.js';
import {
  startGame, setTurnOrder, startCompose, extendCompose, skipTurn,
  submitPrompt, pickImage, regenerate, rejectImage, setTeamGuessCorrect,
  overrideScore, nextTurn, finishGuessing, submitGuess, fullReset,
} from './stateMachine.js';
import {
  getPool, addEntry, updateEntry, removeEntry, resetUsed, unusedCount,
} from './pool.js';
import { getTrivia, addCard, updateCard, removeCard } from './trivia.js';
import { exportSnapshot, importSnapshot, exportFinalScores, type Snapshot } from './snapshot.js';
import { checkPassword, issueSession, requireOperator } from './auth.js';
import { nextJob, completeJob, failJob, getLastPollAt, markPolled, createJob, getJob } from './jobs.js';
import { resolveGenParams } from './defaults.js';

function baseUrl(req: Request): string {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, '');
  const proto = (req.header('x-forwarded-proto') ?? req.protocol).split(',')[0];
  const host = req.header('x-forwarded-host') ?? req.header('host');
  return `${proto}://${host}`;
}

export function buildRouter(): Router {
  const r = Router();

  // ---- Phone routes ------------------------------------------------------
  r.post('/api/join', (req, res) => {
    const parsed = z.object({ teamName: z.string().min(1).max(40) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'teamName required' });
    if (state.phase !== 'lobby') return res.status(409).json({ error: 'game already started' });
    const existing = getTeamByName(parsed.data.teamName);
    if (existing) {
      // Treat as a reconnect/claim of the same team name.
      return res.json({ teamId: existing.id, token: existing.token });
    }
    const team = addTeam(parsed.data.teamName);
    return res.json({ teamId: team.id, token: team.token });
  });

  r.post('/api/rejoin', (req, res) => {
    const parsed = z.object({ token: z.string() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'token required' });
    const team = getTeamByToken(parsed.data.token);
    if (!team) return res.status(404).json({ error: 'unknown token' });
    team.connected = true;
    return res.json({ teamId: team.id, name: team.name });
  });

  r.post('/api/guess', (req, res) => {
    const parsed = z.object({ token: z.string(), text: z.string().max(100) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'token and text required' });
    const team = getTeamByToken(parsed.data.token);
    if (!team) return res.status(404).json({ error: 'unknown token' });
    const outcome = submitGuess(team.id, parsed.data.text);
    return res.json({ accepted: outcome.accepted, correct: outcome.correct, reason: outcome.reason });
  });

  // ---- Prompter Station --------------------------------------------------
  // Lives at the host; gated by game phase rather than operator session.
  r.post('/api/prompt/submit', (req, res) => {
    const parsed = z.object({ prompt: z.string() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'prompt required' });
    const result = submitPrompt(parsed.data.prompt);
    if (result.ok) return res.json({ ok: true });
    return res.status(422).json({ ok: false, errors: result.errors });
  });

  // The Prompter Station picks one image. Gated by the picking phase rather than
  // an operator session (the station is a trusted browser at the host).
  r.post('/api/prompt/pick', (req, res) => {
    const parsed = z.object({ index: z.number().int().min(0) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'index required' });
    if (state.phase !== 'picking') return res.status(409).json({ error: 'not picking' });
    pickImage(parsed.data.index);
    return res.json({ ok: true });
  });

  // ---- Operator auth -----------------------------------------------------
  r.post('/api/operator/login', (req, res) => {
    const parsed = z.object({ password: z.string() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'password required' });
    if (!checkPassword(parsed.data.password)) {
      return res.status(401).json({ error: 'wrong password' });
    }
    const sessionToken = issueSession();
    res.cookie('op_session', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 12,
    });
    return res.json({ sessionToken });
  });

  // ---- Operator actions (all require a valid session) --------------------
  const op = Router();
  op.use(requireOperator);

  op.post('/start-game', (_req, res) => {
    const ok = startGame();
    return res.json({ ok });
  });
  op.post('/set-order', (req, res) => {
    const parsed = z.object({ order: z.array(z.string()) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'order required' });
    setTurnOrder(parsed.data.order);
    return res.json({ ok: true });
  });
  op.post('/start-compose', (_req, res) => { startCompose(); return res.json({ ok: true }); });
  op.post('/extend', (_req, res) => { extendCompose(); return res.json({ ok: true }); });
  op.post('/skip', (_req, res) => { skipTurn(); return res.json({ ok: true }); });
  op.post('/pick-image', (req, res) => {
    const parsed = z.object({ index: z.number().int().min(0) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'index required' });
    pickImage(parsed.data.index);
    return res.json({ ok: true });
  });
  op.post('/regenerate', (_req, res) => { regenerate(); return res.json({ ok: true }); });
  op.post('/reject-image', (req, res) => {
    const parsed = z.object({ index: z.number().int().min(0) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'index required' });
    rejectImage(parsed.data.index);
    return res.json({ ok: true });
  });
  op.post('/accept-guess', (req, res) => {
    const parsed = z.object({ teamId: z.string(), correct: z.boolean().default(true) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'teamId required' });
    setTeamGuessCorrect(parsed.data.teamId, parsed.data.correct);
    return res.json({ ok: true });
  });
  op.post('/override-score', (req, res) => {
    const parsed = z.object({ teamId: z.string(), delta: z.number().int() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'teamId and delta required' });
    overrideScore(parsed.data.teamId, parsed.data.delta);
    return res.json({ ok: true });
  });
  op.post('/finish-guessing', (_req, res) => { finishGuessing(); return res.json({ ok: true }); });
  op.post('/next-turn', (_req, res) => { nextTurn(); return res.json({ ok: true }); });
  op.post('/reset-game', (_req, res) => { resetGame(); fullReset(); return res.json({ ok: true }); });

  // Snapshot export/import (settings + pool + scores).
  op.get('/snapshot', (_req, res) => res.json(exportSnapshot()));
  op.post('/snapshot', (req, res) => {
    importSnapshot(req.body as Snapshot);
    return res.json({ ok: true });
  });
  op.get('/final-scores', (_req, res) => res.json(exportFinalScores()));

  // Pool CRUD (Settings panel).
  op.get('/pool', (_req, res) => res.json({ entries: getPool(), unused: unusedCount() }));
  op.post('/pool', (req, res) => {
    const parsed = z.object({
      target: z.string().min(1),
      forbidden: z.array(z.string()).default([]),
      acceptedGuesses: z.array(z.string()).default([]),
      category: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid entry' });
    return res.json(addEntry(parsed.data));
  });
  op.put('/pool/:id', (req, res) => {
    const updated = updateEntry(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'not found' });
    return res.json(updated);
  });
  op.delete('/pool/:id', (req, res) => { removeEntry(req.params.id); return res.json({ ok: true }); });
  op.post('/pool-reset-used', (_req, res) => { resetUsed(); return res.json({ ok: true }); });

  // Trivia CRUD.
  op.get('/trivia', (_req, res) => res.json({ cards: getTrivia() }));
  op.post('/trivia', (req, res) => {
    const parsed = z.object({ text: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'text required' });
    return res.json(addCard(parsed.data.text));
  });
  op.put('/trivia/:id', (req, res) => {
    const parsed = z.object({ text: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'text required' });
    const updated = updateCard(req.params.id, parsed.data.text);
    if (!updated) return res.status(404).json({ error: 'not found' });
    return res.json(updated);
  });
  op.delete('/trivia/:id', (req, res) => { removeCard(req.params.id); return res.json({ ok: true }); });

  r.use('/api/operator', op);

  // ---- Settings (operator only; spec §15) --------------------------------
  // The safety negative prompt is intentionally NOT exposed here (spec §18/§19).
  const settingsSchema = z.object({
    backendMode: z.enum(['worker', 'tunnel']).optional(),
    tunnelUrl: z.string().optional(),
    gen: z.object({
      checkpoint: z.string(),
      sampler: z.string(),
      steps: z.number().int().min(1).max(60),
      cfgScale: z.number().min(0).max(30),
      width: z.number().int().min(256).max(2048),
      height: z.number().int().min(256).max(2048),
      batchSize: z.number().int().min(1).max(8),
      seedMode: z.enum(['random', 'fixed']),
    }).partial().optional(),
    composeSeconds: z.number().int().min(5).max(600).optional(),
    extendSeconds: z.number().int().min(5).max(300).optional(),
    triviaDelaySeconds: z.number().int().min(0).max(60).optional(),
    pickTimeoutSeconds: z.number().int().min(5).max(600).optional(),
    guessSeconds: z.number().int().min(5).max(600).optional(),
    correctPoints: z.number().int().optional(),
    firstBonus: z.number().int().optional(),
    prompterPerSolve: z.number().int().optional(),
    maxPromptLength: z.number().int().min(10).max(2000).optional(),
    fuzzyGuessing: z.boolean().optional(),
    profanity: z.array(z.string()).optional(),
    multipleGuessesAllowed: z.boolean().optional(),
    nsfwRegenAttempts: z.number().int().min(0).max(10).optional(),
  });

  r.get('/api/settings', requireOperator, (_req, res) => res.json(state.settings));
  r.put('/api/settings', requireOperator, (req, res) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const patch = { ...parsed.data };
    if (patch.gen) patch.gen = { ...state.settings.gen, ...patch.gen };
    setSettings(patch as Partial<typeof state.settings>);
    return res.json(state.settings);
  });

  // ---- QR join link ------------------------------------------------------
  r.get('/api/qr', async (req, res) => {
    const joinUrl = `${baseUrl(req)}/play`;
    const format = (req.query.format as string) ?? 'png';
    if (format === 'svg') {
      const svg = await QRCode.toString(joinUrl, { type: 'svg', margin: 1 });
      res.type('image/svg+xml').send(svg);
      return;
    }
    const buf = await QRCode.toBuffer(joinUrl, { margin: 1, width: 360 });
    res.type('image/png').send(buf);
  });
  r.get('/api/join-url', (req, res) => res.json({ url: `${baseUrl(req)}/play` }));

  // ---- Worker endpoints (Bearer WORKER_SECRET; auth applied in index.ts) --
  // Mounted separately because they use requireWorker rather than the operator
  // session; see registerWorkerRoutes below.

  return r;
}

/** Worker endpoints (spec §12.2). Mounted at `/worker` with Bearer auth applied
 *  by the caller, so paths here are relative to that mount point. */
export function registerWorkerRoutes(r: Router): void {
  r.get('/next-job', async (_req: Request, res: Response) => {
    markPolled();
    const job = await nextJob(25_000);
    if (!job) return res.status(204).end();
    // Send only what the worker needs to call Forge.
    return res.json({
      job: {
        id: job.id,
        prompt: job.prompt,
        genParams: job.genParams,
      },
    });
  });

  r.post('/jobs/:id/result', (req, res) => {
    const parsed = z.object({ images: z.array(z.string()).min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'images required' });
    const ok = completeJob(req.params.id, parsed.data.images);
    return res.status(ok ? 200 : 404).json({ ok });
  });

  r.post('/jobs/:id/fail', (req, res) => {
    const parsed = z.object({ error: z.string() }).safeParse(req.body);
    const ok = failJob(req.params.id, parsed.success ? parsed.data.error : 'unknown worker error');
    return res.status(ok ? 200 : 404).json({ ok });
  });

  r.get('/health', (_req, res) => {
    res.json({ ok: true, lastPollAt: getLastPollAt() });
  });

  // End-to-end test job (used by the flight-check scripts). Creates a job the
  // running worker will pick up, and waits for its result. Does NOT touch
  // GameState — onJobDone ignores jobs that aren't the current turn's job.
  r.post('/test-job', async (req, res) => {
    const prompt = z.object({ prompt: z.string().optional() }).safeParse(req.body);
    const text = prompt.success && prompt.data.prompt ? prompt.data.prompt : 'a friendly robot waving hello, clean studio lighting';
    const job = createJob(text, resolveGenParams(state.settings), '__flightcheck__');
    const startedAt = Date.now();
    // Poll up to 90s for the worker to complete it.
    while (Date.now() - startedAt < 90_000) {
      const current = getJob(job.id);
      if (current?.status === 'done') return res.json({ ok: true, images: current.images?.length ?? 0 });
      if (current?.status === 'failed') return res.status(502).json({ ok: false, error: current.error });
      await new Promise((r2) => setTimeout(r2, 1000));
    }
    return res.status(504).json({ ok: false, error: 'timed out waiting for worker result' });
  });
}

export { getTeamById };
