import type { Match } from "./supabase";
import { teamGoals } from "./achievements";

/**
 * Goals scored and received over a set of matches, counted the way the goal
 * achievements count them (`teamGoals`).
 *
 * An empty field falls back to 10 for the game's winner - exact, since a game
 * runs to 10 - and 0 for its loser, which can only undercount. So a total is
 * always a lower bound, and `exact` says whether it is also the true figure:
 * false as soon as one counted game had no loser's score (or predates series).
 */
export interface GoalTally {
  scored: number;
  received: number;
  exact: boolean;
}

export function emptyGoalTally(): GoalTally {
  return { scored: 0, received: 0, exact: true };
}

/** Every game carries the losing side's score, so nothing was guessed. */
export function isFullyScored(m: Match): boolean {
  return m.games !== null && m.games.every((g) => (g.w === "A" ? g.b : g.a) !== null);
}

export function addMatchGoals(tally: GoalTally, m: Match, side: "A" | "B"): void {
  tally.scored += teamGoals(m, side);
  tally.received += teamGoals(m, side === "A" ? "B" : "A");
  if (!isFullyScored(m)) tally.exact = false;
}

export function playerGoalTally(playerId: string, matches: Match[]): GoalTally {
  const tally = emptyGoalTally();
  for (const m of matches) {
    if (m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId) {
      addMatchGoals(tally, m, "A");
    } else if (m.team_b_player_1_id === playerId || m.team_b_player_2_id === playerId) {
      addMatchGoals(tally, m, "B");
    }
  }
  return tally;
}
