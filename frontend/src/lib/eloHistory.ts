/**
 * Reading a win or a loss off an `elo_history` row.
 *
 * Under the old one-game model a winner's delta was always positive, so the
 * sign of `elo_change` doubled as the result and half the app read it that way.
 * The sum-of-residuals series model the league ran between 2026-08 and 2026-09
 * broke that: a favourite who took a 2-1 with a per-game expectation above 2/3
 * won the match and still lost rating. Those rows are still in the table, so
 * the sign rule stays wrong for them and the result lives on the row itself.
 *
 * Margin scoring (2026-09 onwards) makes a winner's delta non-negative again,
 * but *non-negative* is not *positive* - K·d·(1 − E) rounds to 0 across a wide
 * enough rating gap - so `won` remains the only thing worth reading.
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
