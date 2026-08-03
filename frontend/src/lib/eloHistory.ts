/**
 * Reading a win or a loss off an `elo_history` row.
 *
 * Under the old one-game model a winner's delta was always positive, so the
 * sign of `elo_change` doubled as the result and half the app read it that way.
 * Series scoring breaks that: per-game residuals are summed, so a favourite who
 * takes a 2-1 when their per-game expectation is above 2/3 wins the match and
 * still loses rating. The result is now stored on the row itself.
 *
 * `won` is null on two kinds of row, and the fallback to the old sign rule is
 * correct for both:
 *   - inactivity-penalty rows, which have no result at all (they keep counting
 *     as neither a win nor a loss for `didWin`, and as a loss for `didLose`,
 *     exactly as before - callers that care filter on `match_id` first)
 *   - rows written in the minutes between the migration and the edge function
 *     deploy, which were rated under the old model where the sign held
 *
 * Pure helpers only - no DB calls, no React.
 */

/** Anything carrying an ELO delta and, optionally, the recorded result. */
export interface EloOutcomeRow {
  elo_change: number;
  won?: boolean | null;
}

export function didWin(row: EloOutcomeRow): boolean {
  return row.won ?? row.elo_change > 0;
}

export function didLose(row: EloOutcomeRow): boolean {
  return row.won == null ? row.elo_change < 0 : !row.won;
}
