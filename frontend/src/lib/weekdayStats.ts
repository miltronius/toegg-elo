import type { EloHistory } from "./supabase";

export interface WeekdayStat {
  /** Short weekday label, Monday–Friday. */
  day: string;
  /** Total games played that weekday. */
  games: number;
  wins: number;
  losses: number;
  /** Win % over decisive games (wins + losses), or null when none were played. */
  winrate: number | null;
}

// Monday–Friday only (foosball is played on working days). getDay() returns
// 0=Sun..6=Sat, so Mon..Fri map to 1..5 → indices 0..4 here.
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/**
 * Aggregate a player's ELO history into per-weekday game counts and winrate.
 *
 * - Only match rows count as games; inactivity-penalty rows (match_id == null)
 *   are skipped.
 * - When `seasonId` is provided, only that season's rows are counted; pass null
 *   for all-time. (Mirrors the season filtering used elsewhere in PlayerDetail.)
 * - Win/loss is derived from the sign of elo_change, consistent with the rest of
 *   the app (a rare 0-change game counts toward `games` but not wins/losses).
 */
export function computeWeekdayStats(
  history: EloHistory[],
  seasonId: string | null,
): WeekdayStat[] {
  const stats: WeekdayStat[] = WEEKDAY_LABELS.map((day) => ({
    day,
    games: 0,
    wins: 0,
    losses: 0,
    winrate: null,
  }));

  for (const h of history) {
    if (h.match_id == null) continue;
    if (seasonId != null && h.season_id !== seasonId) continue;
    const dow = new Date(h.created_at).getDay();
    if (dow < 1 || dow > 5) continue; // skip weekends
    const s = stats[dow - 1];
    s.games++;
    if (h.elo_change > 0) s.wins++;
    else if (h.elo_change < 0) s.losses++;
  }

  for (const s of stats) {
    const decided = s.wins + s.losses;
    s.winrate = decided > 0 ? (s.wins / decided) * 100 : null;
  }
  return stats;
}
