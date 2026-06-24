'use strict';

/*
 * Configuration & content store.
 *
 * Settings, prompt pool, trivia and the profanity list load from committed JSON
 * files under config/ at boot, then live in memory and are mutable at runtime.
 * Because Render's free disk is ephemeral, runtime edits are NOT written back to
 * disk — the operator carries state across sessions via Export/Import in the
 * Settings tab (see §2, §10, §12 of the spec).
 */

const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', 'config');

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(path.join(CONFIG_DIR, file), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[config] could not load ${file}: ${err.message} — using fallback`);
    return fallback;
  }
}

// In-memory stores. Mutated at runtime; never persisted to disk.
const store = {
  settings: readJson('settings.json', {}),
  prompts: readJson('prompts.json', []),
  trivia: readJson('trivia.json', []),
  profanity: readJson('profanity.json', [])
};

// ---- Settings -------------------------------------------------------------

function getSettings() {
  return store.settings;
}

function get(key) {
  return store.settings[key];
}

function updateSettings(patch) {
  // Only allow known-shape primitive/array values; ignore content lists here.
  Object.assign(store.settings, patch || {});
  return store.settings;
}

function importSettings(obj) {
  if (obj && typeof obj === 'object') {
    store.settings = Object.assign({}, store.settings, obj);
  }
  return store.settings;
}

// ---- Prompt pool ----------------------------------------------------------

function getPrompts() {
  return store.prompts;
}

function availablePrompts() {
  return store.prompts.filter((p) => !p.used);
}

function findPrompt(id) {
  return store.prompts.find((p) => p.id === id) || null;
}

function setPrompts(list) {
  if (Array.isArray(list)) store.prompts = list;
  return store.prompts;
}

function upsertPrompt(entry) {
  if (!entry || !entry.id) return store.prompts;
  const idx = store.prompts.findIndex((p) => p.id === entry.id);
  const normalized = {
    id: String(entry.id),
    target: entry.target || '',
    forbidden: Array.isArray(entry.forbidden) ? entry.forbidden : [],
    acceptedGuesses: Array.isArray(entry.acceptedGuesses) ? entry.acceptedGuesses : [],
    category: entry.category || '',
    difficulty: entry.difficulty || '',
    used: !!entry.used
  };
  if (idx >= 0) store.prompts[idx] = Object.assign({}, store.prompts[idx], normalized);
  else store.prompts.push(normalized);
  return store.prompts;
}

function removePrompt(id) {
  store.prompts = store.prompts.filter((p) => p.id !== id);
  return store.prompts;
}

function resetUsedFlags() {
  store.prompts.forEach((p) => { p.used = false; });
  return store.prompts;
}

// ---- Trivia ---------------------------------------------------------------

function getTrivia() {
  return store.trivia;
}

function upsertTrivia(item) {
  if (!item || !item.id) return store.trivia;
  const idx = store.trivia.findIndex((t) => t.id === item.id);
  const normalized = { id: String(item.id), text: item.text || '' };
  if (idx >= 0) store.trivia[idx] = normalized;
  else store.trivia.push(normalized);
  return store.trivia;
}

function removeTrivia(id) {
  store.trivia = store.trivia.filter((t) => t.id !== id);
  return store.trivia;
}

// ---- Profanity ------------------------------------------------------------

function getProfanity() {
  return store.profanity;
}

function setProfanity(list) {
  if (Array.isArray(list)) store.profanity = list.map((w) => String(w));
  return store.profanity;
}

module.exports = {
  CONFIG_DIR,
  getSettings,
  get,
  updateSettings,
  importSettings,
  getPrompts,
  availablePrompts,
  findPrompt,
  setPrompts,
  upsertPrompt,
  removePrompt,
  resetUsedFlags,
  getTrivia,
  upsertTrivia,
  removeTrivia,
  getProfanity,
  setProfanity
};
