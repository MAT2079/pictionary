import type { Settings, GenParams } from './types.js';

// Safety negative-prompt baseline. Server-controlled, NOT editable anywhere in
// UI/Settings/env. One layer in a defence-in-depth stack (curated pool + Runware
// checkNSFW + operator veto are the others), not the primary control.
export const SAFETY_NEGATIVE_PROMPT =
  'nsfw, nude, nudity, naked, sexual, sex, explicit, porn, erotic, lewd, ' +
  'genitalia, breasts, gore, blood, violence, disturbing, ' +
  // quality terms
  'lowres, blurry, deformed, disfigured, bad anatomy, watermark, text, signature';

export const DEFAULT_SETTINGS: Settings = {
  runware: {
    // Runware model AIR identifier. Operator can change it in Settings; browse
    // models at https://my.runware.ai/models. "runware:100@1" is a general SDXL.
    model: 'runware:100@1',
    apiKey: '', // session override only; RUNWARE_API_KEY env is canonical
    scheduler: '',
  },

  gen: {
    // `checkpoint` is unused for Runware (the model AIR selects the model).
    checkpoint: '',
    sampler: '',
    // Generalist SDXL defaults; tune per model in Settings.
    steps: 25,
    cfgScale: 6.5,
    width: 1024,
    height: 1024,
    batchSize: 4,
    seedMode: 'random',
  },

  composeSeconds: 60,
  extendSeconds: 20,
  triviaDelaySeconds: 3,
  pickTimeoutSeconds: 45,
  guessSeconds: 30,

  correctPoints: 100,
  firstBonus: 50,
  prompterPerSolve: 50,

  maxPromptLength: 300,
  fuzzyGuessing: false,
  profanity: [], // loaded from data/profanity.txt at boot

  multipleGuessesAllowed: true,
};

/** Resolve a job's GenParams from current Settings, always appending the
 *  server-controlled safety negative prompt. */
export function resolveGenParams(settings: Settings): GenParams {
  return {
    ...settings.gen,
    negativePrompt: SAFETY_NEGATIVE_PROMPT,
  };
}
