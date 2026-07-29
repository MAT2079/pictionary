// Client-side view of the redacted state payloads the server emits (sockets.ts
// serializeFor). Fields are optional because each role receives a subset.

export type Phase =
  | 'lobby' | 'reveal' | 'compose' | 'generating'
  | 'picking' | 'guessing' | 'roundReveal' | 'finalScores';

export interface PublicTeam {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  hasPrompted: boolean;
}

export interface TimerState {
  endsAt: number;
  kind: 'compose' | 'picking' | 'guessing';
}

export interface ClientState {
  phase: Phase;
  teams: PublicTeam[];
  turnOrder: string[];
  currentTurnIndex: number;
  timer: TimerState | null;
  prompterTeamId: string | null;
  prompterTeamName: string | null;

  // Operator / prompter extras
  settings?: Settings;
  backend?: { provider: string; configured: boolean; model: string };
  runwareConfigured?: boolean;
  jobError?: string | null;
  reveal?: { target?: string; forbidden?: string[]; category?: string } | null;
  prompt?: string | null;
  images?: string[];
  chosenImage?: string | null;
  chosenImageIndex?: number | null;
  guesses?: { teamId: string; text: string; correct: boolean; at: number }[];
  awarded?: Record<string, number> | null;
  maxPromptLength?: number;

  // Phone extras
  you?: {
    teamId: string;
    name: string;
    score: number;
    hasPrompted: boolean;
    isPrompter: boolean;
    alreadyCorrect: boolean;
  } | null;
}

export interface Settings {
  runware: { model: string; apiKey: string; scheduler: string };
  gen: {
    checkpoint: string; sampler: string; steps: number; cfgScale: number;
    width: number; height: number; batchSize: number; seedMode: 'random' | 'fixed';
  };
  composeSeconds: number; extendSeconds: number; triviaDelaySeconds: number;
  pickTimeoutSeconds: number; guessSeconds: number;
  correctPoints: number; firstBonus: number; prompterPerSolve: number;
  maxPromptLength: number; fuzzyGuessing: boolean; profanity: string[];
  multipleGuessesAllowed: boolean;
}

export interface RoundReveal {
  target: string;
  prompt: string;
  results: {
    teamId: string; teamName: string; correct: boolean;
    firstCorrect: boolean; awarded: number; guessText?: string;
  }[];
  prompterTeamId: string;
  prompterTeamName: string;
  prompterAwarded: number;
}

export interface TimerTick {
  endsAt: number;
  kind: 'compose' | 'picking' | 'guessing';
  now: number;
}
