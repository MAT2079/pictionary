import { randomUUID } from 'node:crypto';
import type { GameState, Team, Settings } from './types.js';
import { DEFAULT_SETTINGS } from './defaults.js';
import { bus, Events } from './bus.js';

// Single in-memory GameState (spec §3: no database). Persistence across the
// operator's test days is via export/import JSON snapshots (snapshot.ts).
export const state: GameState = {
  phase: 'lobby',
  teams: [],
  turnOrder: [],
  currentTurnIndex: -1,
  currentTurn: undefined,
  timer: undefined,
  settings: structuredClone(DEFAULT_SETTINGS),
};

/** Emit a state-changed signal; sockets.ts re-serializes per role and pushes. */
export function touch(): void {
  bus.emit(Events.StateChanged);
}

// ---- Team reducers -------------------------------------------------------

export function getTeamById(id: string): Team | undefined {
  return state.teams.find((t) => t.id === id);
}

export function getTeamByToken(token: string): Team | undefined {
  return state.teams.find((t) => t.token === token);
}

export function getTeamByName(name: string): Team | undefined {
  const n = name.trim().toLowerCase();
  return state.teams.find((t) => t.name.trim().toLowerCase() === n);
}

export function addTeam(name: string): Team {
  const team: Team = {
    id: randomUUID(),
    name: name.trim().slice(0, 40),
    token: randomUUID(),
    hasPrompted: false,
    score: 0,
    connected: true,
  };
  state.teams.push(team);
  // New teams join the turn order at the end unless the operator reorders.
  if (!state.turnOrder.includes(team.id)) state.turnOrder.push(team.id);
  return team;
}

export function setSettings(patch: Partial<Settings>): void {
  state.settings = { ...state.settings, ...patch };
}

/** Reset scores/turns but keep teams + settings + pool. */
export function resetGame(): void {
  for (const t of state.teams) {
    t.hasPrompted = false;
    t.score = 0;
  }
  state.phase = 'lobby';
  state.currentTurnIndex = -1;
  state.currentTurn = undefined;
  state.timer = undefined;
}
