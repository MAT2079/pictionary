'use strict';

/*
 * Authoritative game state machine (spec §4, §5).
 *
 * Holds the single in-memory GameState and owns the clock — timers are
 * server-authoritative. After any mutation it calls onChange() so the server can
 * re-broadcast role-projected state over WebSocket. setTimeout drives timed phase
 * transitions; broadcast `timer.endsAt` lets clients render a countdown that
 * never trusts a client clock or refresh.
 */

const config = require('./config');
const forge = require('./forge');
const validation = require('./validation');
const { scoreTurn } = require('./scoring');

const PHASES = {
  LOBBY: 'LOBBY',
  REVEAL: 'REVEAL',
  COMPOSE: 'COMPOSE',
  GENERATING: 'GENERATING',
  PICK: 'PICK',
  GUESS: 'GUESS',
  SCORE: 'SCORE',
  FINAL: 'FINAL'
};

const REVEAL_BEAT_MS = 2500; // brief beat before COMPOSE

let onChange = () => {};
let activeTimeout = null;
let genToken = 0; // guards against stale async generation results

const state = {
  phase: PHASES.LOBBY,
  teams: [],
  lobbyLocked: false,
  turnOrder: [],
  currentTurnIndex: 0,
  currentEntryId: null,
  currentPrompt: null, // the actual validated prompt text used (revealed at SCORE)
  candidates: [], // JPEG data URLs for PICK / veto
  chosenImage: null,
  chosenIndex: null,
  guesses: {}, // teamId -> { text, correct, atMs }
  timer: { phase: null, endsAt: 0 },
  generation: { status: 'idle', error: null }, // idle | running | error | done
  lastAward: {}, // teamId -> points awarded this turn (for recompute on manual accept)
  lastTurnResult: null, // snapshot shown during SCORE/FINAL
  triviaIndex: 0
};

function setOnChange(fn) { onChange = fn || (() => {}); }
function emit() { onChange(); }

function s(key) { return config.get(key); }

// ---- Timer helpers --------------------------------------------------------

function clearTimer() {
  if (activeTimeout) { clearTimeout(activeTimeout); activeTimeout = null; }
  state.timer = { phase: null, endsAt: 0 };
}

function startTimer(phase, seconds, onExpire) {
  if (activeTimeout) clearTimeout(activeTimeout);
  state.timer = { phase, endsAt: Date.now() + seconds * 1000 };
  activeTimeout = setTimeout(() => {
    activeTimeout = null;
    onExpire();
  }, seconds * 1000);
}

// ---- Teams ----------------------------------------------------------------

function randId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function addTeam(name, connId) {
  if (state.phase !== PHASES.LOBBY) return { ok: false, error: 'Game already started.' };
  if (state.lobbyLocked) return { ok: false, error: 'Lobby is locked.' };
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean) return { ok: false, error: 'Team name required.' };
  if (state.teams.some((t) => t.name.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, error: 'That team name is taken.' };
  }
  const team = { id: randId('team'), name: clean, connId, joinedAt: Date.now(), score: 0 };
  state.teams.push(team);
  emit();
  return { ok: true, team };
}

function setLobbyLocked(locked) { state.lobbyLocked = !!locked; emit(); }

function teamByConn(connId) { return state.teams.find((t) => t.connId === connId) || null; }
function teamById(id) { return state.teams.find((t) => t.id === id) || null; }

function attachConn(teamId, connId) {
  const t = teamById(teamId);
  if (t) { t.connId = connId; emit(); return t; }
  return null;
}

function currentPrompterId() {
  return state.turnOrder[state.currentTurnIndex] || null;
}

// ---- Game lifecycle -------------------------------------------------------

function startGame() {
  const min = s('MIN_TEAMS') || 2;
  if (state.teams.length < min) return { ok: false, error: `Need at least ${min} teams.` };

  const rounds = Math.max(1, parseInt(s('ROUNDS'), 10) || 1);
  const order = [];
  for (let r = 0; r < rounds; r++) {
    for (const t of state.teams) order.push(t.id);
  }
  state.turnOrder = order;
  state.currentTurnIndex = 0;
  state.lobbyLocked = true;
  enterReveal();
  return { ok: true };
}

function enterReveal() {
  // Pick the next available prompt entry.
  const pool = config.availablePrompts();
  if (pool.length === 0) {
    state.generation = { status: 'error', error: 'Prompt pool is empty — add or reset entries in Settings.' };
    state.phase = PHASES.GENERATING; // park so operator sees the error
    emit();
    return;
  }
  const entry = pool[Math.floor(Math.random() * pool.length)];
  state.currentEntryId = entry.id;
  state.currentPrompt = null;
  state.candidates = [];
  state.chosenImage = null;
  state.chosenIndex = null;
  state.guesses = {};
  state.lastAward = {};
  state.lastTurnResult = null;
  state.generation = { status: 'idle', error: null };
  state._draft = '';
  state.phase = PHASES.REVEAL;
  emit();

  startTimer(PHASES.REVEAL, REVEAL_BEAT_MS / 1000, () => enterCompose());
}

function enterCompose() {
  state.phase = PHASES.COMPOSE;
  emit();
  startTimer(PHASES.COMPOSE, s('COMPOSE_SECONDS') || 60, () => {
    // Timer expired with no submit — auto-submit the latest valid draft if any.
    const entry = config.findPrompt(state.currentEntryId);
    const v = validation.validateSubmission(state._draft || '', entry, config.getProfanity());
    if (v.ok) {
      beginGeneration(v.clean);
    } else {
      // No valid prompt: park in GENERATING with an operator-actionable error.
      state.phase = PHASES.GENERATING;
      state.generation = { status: 'error', error: 'Time expired with no valid prompt. Skip turn or retry.' };
      emit();
    }
  });
}

function setDraft(connId, text) {
  if (state.phase !== PHASES.COMPOSE) return;
  if (teamByConn(connId) && teamByConn(connId).id === currentPrompterId()) {
    state._draft = String(text || '').slice(0, 500);
  }
}

/** Prompter submits a prompt during COMPOSE. Runs the validation pipeline. */
function submitPrompt(connId, text) {
  if (state.phase !== PHASES.COMPOSE) return { ok: false, error: 'Not accepting prompts now.' };
  const team = teamByConn(connId);
  if (!team || team.id !== currentPrompterId()) {
    return { ok: false, error: 'Only the prompting team can submit.' };
  }
  const entry = config.findPrompt(state.currentEntryId);
  const v = validation.validateSubmission(text, entry, config.getProfanity());
  if (!v.ok) return { ok: false, ...v };

  beginGeneration(v.clean);
  return { ok: true, clean: v.clean, stripped: v.stripped };
}

function beginGeneration(prompt) {
  clearTimer();
  state.currentPrompt = prompt;
  state.phase = PHASES.GENERATING;
  state.generation = { status: 'running', error: null };
  state.candidates = [];
  emit();

  const myToken = ++genToken;
  forge.txt2img(prompt, config.getSettings()).then((res) => {
    if (myToken !== genToken) return; // stale (retry/veto superseded)
    if (res.ok) {
      state.candidates = res.images;
      state.generation = { status: 'done', error: null };
      enterPick();
    } else {
      state.generation = { status: 'error', error: res.error };
      emit();
    }
  });
}

function retryGeneration() {
  if (!state.currentPrompt) {
    // No prompt was captured (e.g. expired empty) — nothing to retry; let
    // operator skip the turn instead.
    return { ok: false, error: 'No prompt to retry. Use Skip Turn.' };
  }
  beginGeneration(state.currentPrompt);
  return { ok: true };
}

function enterPick() {
  state.phase = PHASES.PICK;
  emit();
  startTimer(PHASES.PICK, s('PICK_SECONDS') || 20, () => {
    // Auto-pick the first candidate.
    pickImageInternal(0);
  });
}

function pickImage(connId, index) {
  if (state.phase !== PHASES.PICK) return { ok: false, error: 'Not picking now.' };
  const team = teamByConn(connId);
  if (!team || team.id !== currentPrompterId()) {
    return { ok: false, error: 'Only the prompting team can pick.' };
  }
  return pickImageInternal(index);
}

function pickImageInternal(index) {
  const i = Math.max(0, Math.min(state.candidates.length - 1, parseInt(index, 10) || 0));
  if (state.candidates.length === 0) return { ok: false, error: 'No images to pick.' };
  state.chosenIndex = i;
  state.chosenImage = state.candidates[i];
  enterGuess();
  return { ok: true };
}

/** Operator image veto — reject the candidate set and regenerate. */
function vetoRegenerate() {
  if (![PHASES.PICK, PHASES.GUESS].includes(state.phase)) {
    return { ok: false, error: 'Nothing to veto right now.' };
  }
  if (!state.currentPrompt) return { ok: false, error: 'No prompt to regenerate.' };
  beginGeneration(state.currentPrompt);
  return { ok: true };
}

function enterGuess() {
  clearTimer();
  state.phase = PHASES.GUESS;
  state.guesses = {};
  emit();
  startTimer(PHASES.GUESS, s('GUESS_SECONDS') || 45, () => enterScore());
}

function submitGuess(connId, text) {
  if (state.phase !== PHASES.GUESS) return { ok: false, error: 'Not guessing now.' };
  const team = teamByConn(connId);
  if (!team) return { ok: false, error: 'Join a team first.' };
  if (team.id === currentPrompterId()) {
    return { ok: false, error: 'The prompting team does not guess on its own turn.' };
  }
  if (state.guesses[team.id]) return { ok: false, error: 'Your team already guessed.' };

  const entry = config.findPrompt(state.currentEntryId);
  const correct = validation.isCorrectGuess(text, entry);
  state.guesses[team.id] = {
    text: validation.normalizeGuess(text),
    correct,
    atMs: Date.now()
  };
  emit();

  // If every non-prompting team has answered, end the window early.
  const guessers = state.teams.filter((t) => t.id !== currentPrompterId());
  if (guessers.every((t) => state.guesses[t.id])) {
    enterScore();
  }
  return { ok: true, correct };
}

function applyTurnScore() {
  // Reverse the last award, recompute from current guesses, re-apply.
  for (const [teamId, pts] of Object.entries(state.lastAward)) {
    const t = teamById(teamId);
    if (t) t.score -= pts;
  }
  const result = scoreTurn(state.guesses, currentPrompterId(), config.getSettings());
  for (const [teamId, pts] of Object.entries(result.award)) {
    const t = teamById(teamId);
    if (t) t.score += pts;
  }
  state.lastAward = result.award;
  return result;
}

function enterScore() {
  clearTimer();
  const result = applyTurnScore();

  // Mark the consumed entry as used.
  const entry = config.findPrompt(state.currentEntryId);
  if (entry) entry.used = true;

  state.lastTurnResult = {
    prompterTeamId: currentPrompterId(),
    target: entry ? entry.target : '',
    prompt: state.currentPrompt,
    image: state.chosenImage,
    guesses: JSON.parse(JSON.stringify(state.guesses)),
    award: result.award,
    earliestTeamId: result.earliestTeamId,
    numCorrect: result.numCorrect
  };
  state.phase = PHASES.SCORE;
  emit();
}

/** Operator manually accepts a near-miss guess; re-scores the turn. */
function acceptGuess(teamId) {
  if (state.phase !== PHASES.SCORE && state.phase !== PHASES.GUESS) {
    return { ok: false, error: 'Can only accept during guessing or scoring.' };
  }
  const g = state.guesses[teamId];
  if (g) { g.correct = true; }
  else { state.guesses[teamId] = { text: '(operator accepted)', correct: true, atMs: Date.now() }; }

  if (state.phase === PHASES.SCORE) {
    const result = applyTurnScore();
    if (state.lastTurnResult) {
      state.lastTurnResult.guesses = JSON.parse(JSON.stringify(state.guesses));
      state.lastTurnResult.award = result.award;
      state.lastTurnResult.numCorrect = result.numCorrect;
      state.lastTurnResult.earliestTeamId = result.earliestTeamId;
    }
  }
  emit();
  return { ok: true };
}

function overrideScore(teamId, score) {
  const t = teamById(teamId);
  if (!t) return { ok: false, error: 'No such team.' };
  t.score = parseInt(score, 10) || 0;
  emit();
  return { ok: true };
}

function nextTurn() {
  if (state.phase !== PHASES.SCORE) return { ok: false, error: 'Finish the current turn first.' };
  state.currentTurnIndex += 1;
  if (state.currentTurnIndex >= state.turnOrder.length) {
    enterFinal();
  } else {
    enterReveal();
  }
  return { ok: true };
}

function skipTurn() {
  // Abandon the current turn with no score and advance.
  clearTimer();
  genToken++; // invalidate any in-flight generation
  const entry = config.findPrompt(state.currentEntryId);
  if (entry) entry.used = true;
  state.currentTurnIndex += 1;
  if (state.currentTurnIndex >= state.turnOrder.length) enterFinal();
  else enterReveal();
  return { ok: true };
}

function enterFinal() {
  clearTimer();
  state.phase = PHASES.FINAL;
  emit();
}

function endGame() {
  clearTimer();
  genToken++;
  enterFinal();
  return { ok: true };
}

/**
 * Operator "advance phase" — a manual nudge that performs the natural next
 * transition for the current phase (a referee backstop).
 */
function advancePhase() {
  switch (state.phase) {
    case PHASES.REVEAL: enterCompose(); return { ok: true };
    case PHASES.COMPOSE: {
      const entry = config.findPrompt(state.currentEntryId);
      const v = validation.validateSubmission(state._draft || '', entry, config.getProfanity());
      if (v.ok) { beginGeneration(v.clean); return { ok: true }; }
      return { ok: false, error: 'No valid prompt to submit yet.' };
    }
    case PHASES.PICK: return pickImageInternal(state.chosenIndex || 0);
    case PHASES.GUESS: enterScore(); return { ok: true };
    case PHASES.SCORE: return nextTurn();
    default: return { ok: false, error: 'Nothing to advance.' };
  }
}

// ---- Pool status ----------------------------------------------------------

function poolStatus() {
  const all = config.getPrompts();
  const available = all.filter((p) => !p.used).length;
  const used = all.length - available;
  const teams = state.teams.length || 0;
  return { total: all.length, available, used, teams, warning: available < teams };
}

// ---- State snapshot -------------------------------------------------------

function snapshot() {
  return state;
}

module.exports = {
  PHASES,
  setOnChange,
  state,
  snapshot,
  // teams / lobby
  addTeam,
  setLobbyLocked,
  teamByConn,
  teamById,
  attachConn,
  currentPrompterId,
  // lifecycle
  startGame,
  submitPrompt,
  setDraft,
  retryGeneration,
  pickImage,
  vetoRegenerate,
  submitGuess,
  acceptGuess,
  overrideScore,
  nextTurn,
  skipTurn,
  endGame,
  advancePhase,
  poolStatus
};
