// Central data model (spec §7) plus Settings (§15).
// Mirrored in validation.ts via zod where these cross the wire.

export type Phase =
  | 'lobby'
  | 'reveal'
  | 'compose'
  | 'generating'
  | 'picking'
  | 'guessing'
  | 'roundReveal'
  | 'finalScores';

/** A prompt-pool entry. `forbidden` (what the prompter may NOT type) is
 *  deliberately distinct from `acceptedGuesses` (what counts as a correct guess). */
export interface PoolEntry {
  id: string;
  target: string;
  forbidden: string[];
  acceptedGuesses: string[];
  category?: string;
  used: boolean;
}

export interface TriviaCard {
  id: string;
  text: string;
}

export interface Team {
  id: string;
  name: string;
  championSocketId?: string;
  token: string;
  hasPrompted: boolean;
  score: number;
  connected: boolean;
}

export type JobStatus = 'queued' | 'claimed' | 'done' | 'failed';

export interface GenParams {
  checkpoint: string;
  sampler: string;
  steps: number;
  cfgScale: number;
  width: number;
  height: number;
  batchSize: number;
  seedMode: 'random' | 'fixed';
  negativePrompt: string; // safety/quality baseline (server-controlled)
}

export interface Job {
  id: string;
  status: JobStatus;
  prompt: string;
  genParams: GenParams;
  images?: string[]; // base64 JPEG data URLs from the worker
  error?: string;
  createdAt: number;
  claimedAt?: number;
  turnPromptingTeamId?: string; // bookkeeping so a late result maps to its turn
}

export interface Guess {
  teamId: string;
  text: string;
  correct: boolean;
  at: number;
}

export interface Turn {
  promptingTeamId: string;
  entry: PoolEntry;
  prompt?: string;
  chosenImageIndex?: number;
  jobId?: string;
  guesses: Guess[];
  /** Per-team award snapshot, filled at scoring; operator-overridable. */
  awarded?: Record<string, number>;
}

export interface TimerState {
  endsAt: number;
  kind: 'compose' | 'picking' | 'guessing';
}

/** Runtime settings. Mutable in the Settings panel, held in memory, included in
 *  snapshots. */
export interface Settings {
  // Backend: Runware image-generation API (replaces the local worker/Forge stack).
  runware: {
    model: string;       // Runware model AIR identifier, e.g. "runware:100@1"
    apiKey: string;      // session override; env RUNWARE_API_KEY is the canonical source
    scheduler: string;   // optional Runware scheduler name ("" = model default)
  };

  // Image generation (sent per-job as GenParams; negative prompt excluded here).
  // `checkpoint` here is unused for Runware (the model AIR above selects it) but
  // kept so GenParams stays a stable shape.
  gen: {
    checkpoint: string;
    sampler: string;
    steps: number;
    cfgScale: number;
    width: number;
    height: number;
    batchSize: number;   // -> Runware numberResults
    seedMode: 'random' | 'fixed';
  };

  // Timing (seconds, except triviaDelay)
  composeSeconds: number;
  extendSeconds: number;
  triviaDelaySeconds: number;
  pickTimeoutSeconds: number;
  guessSeconds: number;

  // Scoring
  correctPoints: number;
  firstBonus: number;
  prompterPerSolve: number;

  // Validation
  maxPromptLength: number;
  fuzzyGuessing: boolean;
  profanity: string[];

  // Guessing behaviour
  multipleGuessesAllowed: boolean;
}

export interface GameState {
  phase: Phase;
  teams: Team[];
  turnOrder: string[];
  currentTurnIndex: number;
  currentTurn?: Turn;
  timer?: TimerState;
  settings: Settings;
}

export type Role = 'present' | 'operator' | 'prompter' | 'phone';
