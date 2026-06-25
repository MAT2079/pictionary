import type { Job, Turn } from './types.js';
import { state, touch, getTeamById } from './state.js';
import { bus, Events } from './bus.js';
import { resolveGenParams } from './defaults.js';
import { drawEntry, markUsed } from './pool.js';
import { randomCard } from './trivia.js';
import { validatePrompt, isCorrectGuess } from './validation.js';
import { computeScores } from './scoring.js';
import { createJob, setJobHandlers, getJob } from './jobs.js';
import { runDirect } from './forgeDirect.js';

// ---- Module-private runtime that must NOT leak to phones/presentation ----
let phaseTimeout: NodeJS.Timeout | undefined;
let tickInterval: NodeJS.Timeout | undefined;
let triviaInterval: NodeJS.Timeout | undefined;
let latestDraft = ''; // last keystroke draft, used on compose expiry only
let batchImages: string[] = []; // current job's image batch (data URLs)
let lastJobError: string | undefined;

export function getBatchImages(): string[] {
  return batchImages;
}
export function getChosenImage(): string | undefined {
  const idx = state.currentTurn?.chosenImageIndex;
  if (idx === undefined) return undefined;
  return batchImages[idx];
}
export function getLastJobError(): string | undefined {
  return lastJobError;
}
export function setLatestDraft(draft: string): void {
  latestDraft = draft;
}

// ---- Timer machinery (server-authoritative; spec §3) --------------------
function clearTimers(): void {
  if (phaseTimeout) clearTimeout(phaseTimeout);
  if (tickInterval) clearInterval(tickInterval);
  phaseTimeout = undefined;
  tickInterval = undefined;
  state.timer = undefined;
}

function startTimer(
  kind: 'compose' | 'picking' | 'guessing',
  seconds: number,
  onExpire: () => void,
): void {
  clearTimers();
  const endsAt = Date.now() + seconds * 1000;
  state.timer = { endsAt, kind };
  const emitTick = () => bus.emit(Events.TimerTick, { endsAt, kind, now: Date.now() });
  emitTick();
  tickInterval = setInterval(emitTick, 250); // ~4 Hz
  phaseTimeout = setTimeout(() => {
    clearTimers();
    onExpire();
  }, seconds * 1000);
}

function stopTrivia(): void {
  if (triviaInterval) clearInterval(triviaInterval);
  triviaInterval = undefined;
}

// ---- Lobby / game start --------------------------------------------------
export function setTurnOrder(ids: string[]): void {
  // Keep only ids that correspond to real teams; append any missing teams.
  const valid = ids.filter((id) => getTeamById(id));
  for (const t of state.teams) if (!valid.includes(t.id)) valid.push(t.id);
  state.turnOrder = valid;
  touch();
}

export function startGame(): boolean {
  if (state.teams.length < 2) return false;
  if (state.turnOrder.length === 0) state.turnOrder = state.teams.map((t) => t.id);
  state.currentTurnIndex = -1;
  for (const t of state.teams) t.hasPrompted = false;
  advanceToReveal();
  return true;
}

// ---- reveal --------------------------------------------------------------
function advanceToReveal(): void {
  clearTimers();
  stopTrivia();
  batchImages = [];
  lastJobError = undefined;
  state.currentTurnIndex += 1;

  if (state.currentTurnIndex >= state.turnOrder.length) {
    state.phase = 'finalScores';
    state.currentTurn = undefined;
    touch();
    return;
  }

  const promptingTeamId = state.turnOrder[state.currentTurnIndex];
  const entry = drawEntry();
  if (!entry) {
    // Out of fresh pool entries: jump to final scores rather than dead-end.
    state.phase = 'finalScores';
    state.currentTurn = undefined;
    touch();
    return;
  }

  const turn: Turn = { promptingTeamId, entry, guesses: [] };
  state.currentTurn = turn;
  state.phase = 'reveal';
  latestDraft = '';
  touch();
}

// ---- compose -------------------------------------------------------------
export function startCompose(): void {
  if (state.phase !== 'reveal' || !state.currentTurn) return;
  state.phase = 'compose';
  touch();
  startTimer('compose', state.settings.composeSeconds, onComposeExpiry);
}

export function extendCompose(): void {
  if (state.phase !== 'compose') return;
  startTimer('compose', state.settings.extendSeconds, onComposeExpiry);
  touch();
}

function onComposeExpiry(): void {
  if (state.phase !== 'compose' || !state.currentTurn) return;
  // Validate the latest draft; if valid, proceed, else surface errors and wait
  // for the operator to extend or skip (spec §8 step 3).
  const result = submitPrompt(latestDraft);
  if (!result.ok) {
    // Stay in compose with timer expired; operator decides next.
    touch();
  }
}

export interface SubmitResult {
  ok: boolean;
  errors: { type: string; term?: string }[];
}

/** Validate + (on success) create a Job and move to generating. Called from
 *  the REST submit route and from compose-timer expiry. */
export function submitPrompt(raw: string): SubmitResult {
  const turn = state.currentTurn;
  if (!turn || state.phase !== 'compose') {
    return { ok: false, errors: [{ type: 'phase' }] };
  }
  const v = validatePrompt(raw, turn.entry.forbidden, state.settings);
  if (!v.ok) {
    return { ok: false, errors: v.errors };
  }

  turn.prompt = v.cleaned;
  markUsed(turn.entry.id); // commit the draw only now (spec §8 step 3)
  startGenerating(v.cleaned);
  return { ok: true, errors: [] };
}

// ---- generating ----------------------------------------------------------
function startGenerating(prompt: string): void {
  clearTimers();
  const turn = state.currentTurn!;
  const genParams = resolveGenParams(state.settings);
  const job = createJob(prompt, genParams, turn.promptingTeamId);
  turn.jobId = job.id;
  state.phase = 'generating';
  lastJobError = undefined;
  batchImages = [];
  touch();

  // Trivia interstitial after triviaDelay until images arrive (spec §8 step 4).
  stopTrivia();
  const showCard = () => {
    const card = randomCard();
    if (card) bus.emit(Events.TriviaShow, { card });
  };
  const delay = setTimeout(() => {
    showCard();
    triviaInterval = setInterval(showCard, 6000);
  }, state.settings.triviaDelaySeconds * 1000);
  if (typeof delay.unref === 'function') delay.unref();

  // Tunnel mode: server calls Forge directly. Worker mode: job waits in queue.
  if (state.settings.backendMode === 'tunnel') {
    void runDirect(job);
  }
}

function onJobDone(job: Job): void {
  const turn = state.currentTurn;
  if (!turn || job.id !== turn.jobId) return; // stale/superseded job
  stopTrivia();
  batchImages = job.images ?? [];
  lastJobError = undefined;
  state.phase = 'picking';
  turn.chosenImageIndex = undefined;
  touch();
  bus.emit(Events.ImagesReady, { jobId: job.id, images: batchImages });
  startTimer('picking', state.settings.pickTimeoutSeconds, onPickExpiry);
}

function onJobFail(job: Job): void {
  const turn = state.currentTurn;
  if (!turn || job.id !== turn.jobId) return;
  stopTrivia();
  lastJobError = job.error ?? 'Generation failed.';
  // Stay in generating; operator can Regenerate. Surfaced to operator via state.
  touch();
}

// ---- picking -------------------------------------------------------------
function onPickExpiry(): void {
  // If the prompter never picked, auto-pick the first image so the show goes on.
  if (state.phase === 'picking' && state.currentTurn) {
    if (state.currentTurn.chosenImageIndex === undefined && batchImages.length > 0) {
      pickImage(0);
    }
  }
}

export function pickImage(index: number): void {
  const turn = state.currentTurn;
  if (!turn || state.phase !== 'picking') return;
  if (index < 0 || index >= batchImages.length) return;
  turn.chosenImageIndex = index;
  state.phase = 'guessing';
  touch();
  startTimer('guessing', state.settings.guessSeconds, onGuessExpiry);
}

export function rejectImage(index: number): void {
  // Operator veto on the pick grid (final human safety gate, spec §19 step 5).
  if (state.phase !== 'picking') return;
  if (index < 0 || index >= batchImages.length) return;
  batchImages.splice(index, 1);
  bus.emit(Events.ImagesReady, { jobId: state.currentTurn?.jobId, images: batchImages });
  touch();
}

export function regenerate(): void {
  const turn = state.currentTurn;
  if (!turn || (state.phase !== 'picking' && state.phase !== 'generating')) return;
  if (!turn.prompt) return;
  const genParams = resolveGenParams(state.settings); // new seeds (random mode)
  const job = createJob(turn.prompt, genParams, turn.promptingTeamId);
  turn.jobId = job.id;
  turn.chosenImageIndex = undefined;
  batchImages = [];
  state.phase = 'generating';
  touch();
  if (state.settings.backendMode === 'tunnel') void runDirect(job);
}

// ---- guessing ------------------------------------------------------------
export interface GuessOutcome {
  accepted: boolean;
  correct: boolean;
  reason?: string;
}

export function submitGuess(teamId: string, text: string): GuessOutcome {
  const turn = state.currentTurn;
  if (!turn || state.phase !== 'guessing') {
    return { accepted: false, correct: false, reason: 'not-guessing' };
  }
  if (teamId === turn.promptingTeamId) {
    return { accepted: false, correct: false, reason: 'prompter-cannot-guess' };
  }
  const existing = turn.guesses.filter((g) => g.teamId === teamId);
  const alreadyCorrect = existing.some((g) => g.correct);
  if (alreadyCorrect) {
    return { accepted: false, correct: true, reason: 'already-correct' };
  }
  if (!state.settings.multipleGuessesAllowed && existing.length > 0) {
    return { accepted: false, correct: false, reason: 'one-guess-only' };
  }

  const correct = isCorrectGuess(
    text,
    turn.entry.acceptedGuesses,
    state.settings.fuzzyGuessing,
  );
  turn.guesses.push({ teamId, text, correct, at: Date.now() });
  touch();
  return { accepted: true, correct };
}

/** Operator manual override: force a team's guesses correct/incorrect (spec §9). */
export function setTeamGuessCorrect(teamId: string, correct: boolean): void {
  const turn = state.currentTurn;
  if (!turn) return;
  const teamGuesses = turn.guesses.filter((g) => g.teamId === teamId);
  if (teamGuesses.length === 0 && correct) {
    turn.guesses.push({ teamId, text: '(operator override)', correct: true, at: Date.now() });
  } else {
    for (const g of teamGuesses) g.correct = correct;
  }
  touch();
}

function onGuessExpiry(): void {
  finishGuessing();
}

/** Operator can also end guessing early; both paths land here. */
export function finishGuessing(): void {
  const turn = state.currentTurn;
  if (!turn) return;
  clearTimers();
  applyScores();
  state.phase = 'roundReveal';
  touch();
  emitRoundReveal();
}

function applyScores(): void {
  const turn = state.currentTurn!;
  const result = computeScores(turn, state.settings);
  const awarded: Record<string, number> = {};

  for (const [teamId, pts] of Object.entries(result.perTeam)) {
    const team = getTeamById(teamId);
    if (team) team.score += pts;
    awarded[teamId] = pts;
  }
  const prompter = getTeamById(turn.promptingTeamId);
  if (prompter) prompter.score += result.prompter;
  awarded[turn.promptingTeamId] = result.prompter;

  turn.awarded = awarded;
}

function emitRoundReveal(): void {
  const turn = state.currentTurn!;
  const result = computeScores(turn, state.settings);
  const results = state.teams
    .filter((t) => t.id !== turn.promptingTeamId)
    .map((t) => {
      const teamGuesses = turn.guesses.filter((g) => g.teamId === t.id);
      const correct = teamGuesses.some((g) => g.correct);
      const lastGuess = teamGuesses[teamGuesses.length - 1];
      return {
        teamId: t.id,
        teamName: t.name,
        correct,
        firstCorrect: result.firstCorrectTeamId === t.id,
        awarded: turn.awarded?.[t.id] ?? 0,
        guessText: lastGuess?.text,
      };
    });
  const prompter = getTeamById(turn.promptingTeamId);
  bus.emit(Events.RoundReveal, {
    target: turn.entry.target,
    prompt: turn.prompt ?? '',
    results,
    prompterTeamId: turn.promptingTeamId,
    prompterTeamName: prompter?.name ?? '?',
    prompterAwarded: turn.awarded?.[turn.promptingTeamId] ?? 0,
  });
}

// ---- roundReveal -> next -------------------------------------------------
export function overrideScore(teamId: string, delta: number): void {
  const team = getTeamById(teamId);
  if (!team) return;
  team.score += delta;
  touch();
}

export function nextTurn(): void {
  const finished = state.currentTurn;
  if (finished) {
    const team = getTeamById(finished.promptingTeamId);
    if (team) team.hasPrompted = true;
  }
  advanceToReveal();
}

export function skipTurn(): void {
  // No prompt scored for a skipped turn (spec §8 step 3).
  const cur = state.currentTurn;
  if (cur) {
    const team = getTeamById(cur.promptingTeamId);
    if (team) team.hasPrompted = true;
  }
  advanceToReveal();
}

export function fullReset(): void {
  clearTimers();
  stopTrivia();
  batchImages = [];
  lastJobError = undefined;
  latestDraft = '';
}

// Wire job completion callbacks once at module load.
setJobHandlers({ onDone: onJobDone, onFail: onJobFail });

// Expose getJob re-export for http/sockets convenience.
export { getJob };
