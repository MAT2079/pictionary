import { EventEmitter } from 'node:events';

/** Decouples game logic (state machine, jobs) from the Socket.IO layer.
 *  sockets.ts subscribes; everything else just emits. */
export const bus = new EventEmitter();
bus.setMaxListeners(50);

export interface TimerTick {
  endsAt: number;
  kind: 'compose' | 'picking' | 'guessing';
  now: number;
}

export interface RoundRevealPayload {
  target: string;
  prompt: string;
  results: {
    teamId: string;
    teamName: string;
    correct: boolean;
    firstCorrect: boolean;
    awarded: number;
    guessText?: string;
  }[];
  prompterTeamId: string;
  prompterTeamName: string;
  prompterAwarded: number;
}

export const Events = {
  StateChanged: 'state:changed',
  TimerTick: 'timer:tick',
  ImagesReady: 'images:ready', // { jobId, images }
  TriviaShow: 'trivia:show', // { card }
  RoundReveal: 'round:reveal', // RoundRevealPayload
} as const;
