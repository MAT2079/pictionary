import type { Turn, Settings } from './types.js';

export interface ScoreResult {
  /** teamId -> points awarded this round (guessing teams). */
  perTeam: Record<string, number>;
  /** points awarded to the prompting team. */
  prompter: number;
  /** teamId of the single first correct guesser, if any. */
  firstCorrectTeamId?: string;
  /** teamIds that solved (>=1 correct guess). */
  solverTeamIds: string[];
}

/** Compute the default scoring scheme (spec §11). Every award is operator-
 *  overridable at roundReveal, but this is the baseline.
 *
 *  - Each guessing team with >=1 correct guess: +correctPoints
 *  - The single first team to be correct: additional +firstBonus
 *  - Prompting team: +prompterPerSolve * (teams that solved); 0 if none solved.
 */
export function computeScores(turn: Turn, settings: Settings): ScoreResult {
  const perTeam: Record<string, number> = {};

  // Determine, per team, whether they solved and when their first correct was.
  const firstCorrectAtByTeam = new Map<string, number>();
  for (const g of turn.guesses) {
    if (!g.correct) continue;
    if (g.teamId === turn.promptingTeamId) continue; // prompter can't guess
    const existing = firstCorrectAtByTeam.get(g.teamId);
    if (existing === undefined || g.at < existing) {
      firstCorrectAtByTeam.set(g.teamId, g.at);
    }
  }

  const solverTeamIds = [...firstCorrectAtByTeam.keys()];

  // Base correct points for each solving team.
  for (const teamId of solverTeamIds) {
    perTeam[teamId] = (perTeam[teamId] ?? 0) + settings.correctPoints;
  }

  // First-correct bonus to the single earliest team overall.
  let firstCorrectTeamId: string | undefined;
  let earliest = Infinity;
  for (const [teamId, at] of firstCorrectAtByTeam) {
    if (at < earliest) {
      earliest = at;
      firstCorrectTeamId = teamId;
    }
  }
  if (firstCorrectTeamId) {
    perTeam[firstCorrectTeamId] += settings.firstBonus;
  }

  // Prompter incentive: proportional to how many teams solved; ZERO if none.
  const prompter = solverTeamIds.length * settings.prompterPerSolve;

  return { perTeam, prompter, firstCorrectTeamId, solverTeamIds };
}
