'use strict';

/*
 * Scoring (spec §9). Pure function over the recorded guesses for a turn.
 *
 * - Each correct guessing team scores CORRECT_POINTS.
 * - Optional first-correct speed bonus (FIRST_CORRECT_BONUS) to the earliest
 *   correct team, when SPEED_BONUS_ENABLED.
 * - The prompter team scores PROMPTER_POINTS_PER_TEAM × (number of correct teams).
 * - If nobody guesses and ZERO_IF_NONE is on, the prompter scores zero.
 *
 * Returns a map teamId -> points to award this turn (does not mutate state).
 */
function scoreTurn(guesses, prompterTeamId, settings) {
  const award = {};
  const s = settings || {};

  // Collect correct guesses with their timestamps.
  const correct = Object.entries(guesses || {})
    .filter(([, g]) => g && g.correct)
    .map(([teamId, g]) => ({ teamId, atMs: g.atMs || 0 }));

  // Base points + identify earliest for the speed bonus.
  let earliest = null;
  for (const c of correct) {
    award[c.teamId] = (award[c.teamId] || 0) + (s.CORRECT_POINTS || 0);
    if (!earliest || c.atMs < earliest.atMs) earliest = c;
  }

  if (s.SPEED_BONUS_ENABLED && earliest) {
    award[earliest.teamId] = (award[earliest.teamId] || 0) + (s.FIRST_CORRECT_BONUS || 0);
  }

  // Prompter team reward.
  const numCorrect = correct.length;
  if (numCorrect === 0 && s.ZERO_IF_NONE) {
    award[prompterTeamId] = (award[prompterTeamId] || 0) + 0;
  } else {
    award[prompterTeamId] =
      (award[prompterTeamId] || 0) + (s.PROMPTER_POINTS_PER_TEAM || 0) * numCorrect;
  }

  return { award, earliestTeamId: earliest ? earliest.teamId : null, numCorrect };
}

module.exports = { scoreTurn };
