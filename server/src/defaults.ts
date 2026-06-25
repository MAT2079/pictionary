import type { Settings, GenParams } from './types.js';

// Safety negative-prompt baseline (spec §18/§19). Server-controlled, NOT editable
// anywhere in UI/Settings/env. Weak at the low CFG fast models use, so it is a
// minor layer in a defence-in-depth stack, not the primary control.
export const SAFETY_NEGATIVE_PROMPT =
  'nsfw, nude, nudity, naked, sexual, sex, explicit, porn, erotic, lewd, ' +
  'genitalia, breasts, gore, blood, violence, disturbing, ' +
  // quality terms
  'lowres, blurry, deformed, disfigured, bad anatomy, watermark, text, signature';

export const DEFAULT_SETTINGS: Settings = {
  backendMode: 'worker',
  tunnelUrl: '',

  gen: {
    // SDXL Lightning generalist (spec §18). The exact filename must match what
    // Forge lists in /sdapi/v1/sd-models; operator can adjust in Settings.
    checkpoint: 'dreamshaperXL_lightningDPMSDE',
    sampler: 'DPM++ SDE',
    steps: 6,
    cfgScale: 2.0,
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

  nsfwRegenAttempts: 2,
};

/** Resolve a job's GenParams from current Settings, always appending the
 *  server-controlled safety negative prompt. */
export function resolveGenParams(settings: Settings): GenParams {
  return {
    ...settings.gen,
    negativePrompt: SAFETY_NEGATIVE_PROMPT,
  };
}
