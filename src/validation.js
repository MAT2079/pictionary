'use strict';

/*
 * Prompt & guess validation (spec §6).
 *
 * Forbidden-word matching MUST be whole-word, case-insensitive, with word
 * boundaries — never substring. ("leo" must not block "chameleon".)
 */

// Characters the player is allowed to keep: letters, spaces, commas, hyphens,
// apostrophes. Everything else (parentheses, brackets, colons, angle brackets,
// digits, <lora:…> weighting syntax) is silently stripped.
const ALLOWED_RE = /[^a-zA-Z ,'\-]+/g;

/**
 * Step 1 — sanitize charset (silent). Strips disallowed characters and
 * collapses repeated whitespace. Returns the cleaned prompt and the set of
 * distinct characters that were removed (for the live UI indicator).
 */
function sanitize(input) {
  const original = String(input || '');
  const stripped = new Set();
  for (const ch of original) {
    if (/[a-zA-Z ,'\-]/.test(ch)) continue;
    stripped.add(ch);
  }
  const clean = original
    .replace(ALLOWED_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { clean, stripped: Array.from(stripped) };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a whole-word, case-insensitive matcher for a surface form. Multi-word
 * forbidden phrases ("big cat") are matched as a phrase with flexible internal
 * whitespace, still bounded at both ends.
 */
function phraseRegExp(phrase) {
  const parts = String(phrase).trim().split(/\s+/).map(escapeRegExp);
  if (parts.length === 0 || parts[0] === '') return null;
  const body = parts.join('\\s+');
  // (^|\W) ... (\W|$) word-ish boundaries that also work for hyphen/apostrophe.
  return new RegExp(`(^|[^a-zA-Z])(${body})([^a-zA-Z]|$)`, 'i');
}

/**
 * Step 2 — forbidden-word check (hard reject). Returns the first forbidden
 * surface form found in the (already sanitized) text, or null if clean.
 */
function findForbidden(text, forbiddenList) {
  const hay = ` ${text} `;
  for (const word of forbiddenList || []) {
    const re = phraseRegExp(word);
    if (re && re.test(hay)) return word;
  }
  return null;
}

/**
 * Step 3 — profanity check (hard reject). Returns true if any banned word is
 * present (whole-word, case-insensitive).
 */
function hasProfanity(text, profanityList) {
  const hay = ` ${text} `;
  for (const word of profanityList || []) {
    const re = phraseRegExp(word);
    if (re && re.test(hay)) return true;
  }
  return false;
}

/**
 * Full submission pipeline. Returns:
 *   { ok: true, clean, stripped }
 * or
 *   { ok: false, reason: 'forbidden'|'profanity', word?, clean, stripped }
 */
function validateSubmission(input, entry, profanityList) {
  const { clean, stripped } = sanitize(input);

  if (!clean) {
    return { ok: false, reason: 'empty', clean, stripped };
  }

  const forbidden = findForbidden(clean, entry ? entry.forbidden : []);
  if (forbidden) {
    return { ok: false, reason: 'forbidden', word: forbidden, clean, stripped };
  }

  if (hasProfanity(clean, profanityList)) {
    return { ok: false, reason: 'profanity', clean, stripped };
  }

  return { ok: true, clean, stripped };
}

/**
 * Live preview for the prompter's compose box: sanitizes and reports which
 * forbidden words currently appear (without rejecting). Used for the live filter
 * indicator (spec §8.3).
 */
function previewPrompt(input, entry, profanityList) {
  const { clean, stripped } = sanitize(input);
  const hits = [];
  for (const word of (entry ? entry.forbidden : []) || []) {
    const re = phraseRegExp(word);
    if (re && re.test(` ${clean} `)) hits.push(word);
  }
  const profane = hasProfanity(clean, profanityList);
  return { clean, stripped, forbiddenHits: hits, profane };
}

/**
 * Guess matching (spec §6): normalize (trim, lowercase) and match against the
 * entry's acceptedGuesses.
 */
function normalizeGuess(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isCorrectGuess(text, entry) {
  if (!entry) return false;
  const g = normalizeGuess(text);
  if (!g) return false;
  return (entry.acceptedGuesses || []).some((a) => normalizeGuess(a) === g);
}

module.exports = {
  sanitize,
  findForbidden,
  hasProfanity,
  validateSubmission,
  previewPrompt,
  normalizeGuess,
  isCorrectGuess
};
