import type { Settings } from './types.js';

export interface ValidationError {
  type: 'length' | 'forbidden' | 'profanity';
  term?: string;
}

export interface ValidationResult {
  ok: boolean;
  cleaned: string; // sanitized prompt that proceeds (even on reject, for echo)
  errors: ValidationError[];
}

/** Escape a term for use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive match. Multi-word phrases match as a bounded
 *  phrase with flexible internal whitespace. Must NOT substring-match
 *  (e.g. "leo" must not block "chameleon"). */
export function matchesWholeWord(haystack: string, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  const parts = t.split(/\s+/).map(escapeRe);
  // \b around the whole phrase; \s+ between words.
  const pattern = `(?<![\\p{L}\\p{N}])${parts.join('\\s+')}(?![\\p{L}\\p{N}])`;
  const re = new RegExp(pattern, 'iu');
  return re.test(haystack);
}

/** Charset sanitize (spec §10.2): keep [A-Za-z\s,'-] only. This strips digits,
 *  parentheses, brackets, colons, angle brackets — removing weighting/LoRA
 *  syntax that players must never reach (§21). Collapse whitespace; trim. */
export function sanitizePrompt(raw: string): string {
  return raw
    .replace(/[^A-Za-z\s,'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Run the full validation pipeline server-side (spec §10), in order:
 *  1) length, 2) charset sanitize (silent), 3) forbidden, 4) profanity.
 *  Only a prompt passing 1, 3, 4 (after 2) should create a Job. */
export function validatePrompt(
  raw: string,
  forbidden: string[],
  settings: Settings,
): ValidationResult {
  const errors: ValidationError[] = [];

  // 1) Length — checked against the raw input the player sees/typed.
  if (raw.length > settings.maxPromptLength) {
    return {
      ok: false,
      cleaned: '',
      errors: [{ type: 'length' }],
    };
  }

  // 2) Charset sanitize (silent).
  const cleaned = sanitizePrompt(raw);

  // 3) Forbidden words (hard reject) — report each offending term.
  for (const term of forbidden) {
    if (matchesWholeWord(cleaned, term)) {
      errors.push({ type: 'forbidden', term });
    }
  }

  // 4) Profanity (hard reject) — generic message, never echo the term.
  for (const term of settings.profanity) {
    if (matchesWholeWord(cleaned, term)) {
      errors.push({ type: 'profanity' });
      break; // one generic profanity error is enough
    }
  }

  return { ok: errors.length === 0, cleaned, errors };
}

/** Returns just the forbidden terms a draft currently hits (for live keystroke
 *  highlighting). Operates on the sanitized form so it matches submit behaviour. */
export function forbiddenHits(draft: string, forbidden: string[]): string[] {
  const cleaned = sanitizePrompt(draft);
  return forbidden.filter((term) => matchesWholeWord(cleaned, term));
}

// ---- Guess matching (spec §9) -------------------------------------------

/** Normalize: lowercase, trim, collapse whitespace, strip punctuation. */
export function normalizeGuess(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/** A guess is correct if its normalized form equals any normalized accepted
 *  guess. With fuzzyGuessing on, Levenshtein distance <= 1 also accepts. */
export function isCorrectGuess(
  text: string,
  acceptedGuesses: string[],
  fuzzy: boolean,
): boolean {
  const g = normalizeGuess(text);
  if (!g) return false;
  for (const accepted of acceptedGuesses) {
    const a = normalizeGuess(accepted);
    if (g === a) return true;
    if (fuzzy && levenshtein(g, a) <= 1) return true;
  }
  return false;
}
