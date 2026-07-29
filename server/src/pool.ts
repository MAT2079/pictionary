import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import YAML from 'yaml';
import type { PoolEntry } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

// The prompt pool lives in memory (spec §3) and is included in snapshots.
let pool: PoolEntry[] = [];

interface RawPoolEntry {
  target: string;
  forbidden?: string[];
  acceptedGuesses?: string[];
  category?: string;
  used?: boolean;
  id?: string;
}

function normalizeEntry(raw: RawPoolEntry): PoolEntry {
  return {
    id: raw.id ?? randomUUID(),
    target: String(raw.target),
    forbidden: (raw.forbidden ?? []).map((s) => String(s)),
    acceptedGuesses:
      raw.acceptedGuesses && raw.acceptedGuesses.length > 0
        ? raw.acceptedGuesses.map((s) => String(s))
        : [String(raw.target)],
    category: raw.category,
    used: raw.used ?? false,
  };
}

/** Load the pool at boot: prefer data/prompts.yaml, fall back to the example. */
export function loadPool(): void {
  const custom = join(DATA_DIR, 'prompts.yaml');
  const example = join(DATA_DIR, 'prompts.example.yaml');
  const path = existsSync(custom) ? custom : example;
  const raw = YAML.parse(readFileSync(path, 'utf8')) as RawPoolEntry[];
  pool = (raw ?? []).map(normalizeEntry);
}

export function getPool(): PoolEntry[] {
  return pool;
}

export function setPool(entries: PoolEntry[]): void {
  pool = entries.map(normalizeEntry);
}

export function unusedCount(): number {
  return pool.filter((e) => !e.used).length;
}

/** Draw a random unused entry. Marks intent only; the caller sets used:true
 *  once a valid prompt is actually submitted (spec §8 step 2/3). */
export function drawEntry(): PoolEntry | undefined {
  const candidates = pool.filter((e) => !e.used);
  if (candidates.length === 0) return undefined;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function markUsed(id: string): void {
  const e = pool.find((x) => x.id === id);
  if (e) e.used = true;
}

export function resetUsed(): void {
  for (const e of pool) e.used = false;
}

// ---- CRUD for the Settings panel ----------------------------------------

export function addEntry(input: Omit<PoolEntry, 'id' | 'used'>): PoolEntry {
  const entry = normalizeEntry({ ...input });
  pool.push(entry);
  return entry;
}

export function updateEntry(id: string, patch: Partial<PoolEntry>): PoolEntry | undefined {
  const e = pool.find((x) => x.id === id);
  if (!e) return undefined;
  Object.assign(e, normalizeEntry({ ...e, ...patch, id }));
  return e;
}

export function removeEntry(id: string): void {
  pool = pool.filter((e) => e.id !== id);
}
