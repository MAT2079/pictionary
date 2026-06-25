import { state, setSettings } from './state.js';
import { getPool, setPool } from './pool.js';
import { getTrivia, setTrivia } from './trivia.js';
import type { PoolEntry, TriviaCard, Settings, Team } from './types.js';

// Export/import JSON snapshot (spec §3, §15-Game). Persistence across the
// operator's test days without a database. Round-trips settings + pool + scores.

export interface Snapshot {
  version: 1;
  exportedAt: string;
  settings: Settings;
  pool: PoolEntry[];
  trivia: TriviaCard[];
  teams: Pick<Team, 'id' | 'name' | 'score' | 'hasPrompted'>[];
  turnOrder: string[];
}

export function exportSnapshot(): Snapshot {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: structuredClone(state.settings),
    pool: structuredClone(getPool()),
    trivia: structuredClone(getTrivia()),
    teams: state.teams.map((t) => ({
      id: t.id,
      name: t.name,
      score: t.score,
      hasPrompted: t.hasPrompted,
    })),
    turnOrder: [...state.turnOrder],
  };
}

export function importSnapshot(snap: Snapshot): void {
  if (snap.settings) setSettings(snap.settings);
  if (snap.pool) setPool(snap.pool);
  if (snap.trivia) setTrivia(snap.trivia);
  if (snap.teams) {
    // Restore scores onto existing teams by id where possible; otherwise rebuild.
    for (const saved of snap.teams) {
      const existing = state.teams.find((t) => t.id === saved.id);
      if (existing) {
        existing.score = saved.score;
        existing.hasPrompted = saved.hasPrompted;
        existing.name = saved.name;
      }
    }
  }
  if (snap.turnOrder) state.turnOrder = snap.turnOrder.filter((id) => state.teams.some((t) => t.id === id));
}

/** A scores-only export for the final scoreboard (spec §15-Game). */
export function exportFinalScores(): { name: string; score: number }[] {
  return [...state.teams]
    .sort((a, b) => b.score - a.score)
    .map((t) => ({ name: t.name, score: t.score }));
}
