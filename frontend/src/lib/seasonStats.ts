import type { Match, Player, EloHistory } from "./supabase";

// Monday–Friday only — foosball is played on working days, consistent with
// weekdayStats.ts and the all_weekdays achievement. getDay(): 0=Sun..6=Sat.
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export interface WeekdayGames {
  day: string;
  games: number;
}

export interface SeasonStats {
  /** Total matches played in scope. */
  gamesPlayed: number;
  /** Distinct players who played at least one match. */
  activePlayers: number;
  /** Match counts per workday (Mon–Fri). */
  weekday: WeekdayGames[];
  /** Player with the longest run of consecutive wins. */
  topStreak: { name: string; streak: number } | null;
  /** Best net ELO gained by a single player on a single calendar day. */
  bestDayGain: { name: string; day: string; gain: number } | null;
  /** Largest ELO gain from a single match. */
  biggestWin: { name: string; gain: number } | null;
  /** Calendar day with the most matches. */
  busiestDay: { day: string; games: number } | null;
}

/** Whether `playerId` was on the winning side of `m` (null if they didn't play). */
function playerWon(m: Match, playerId: string): boolean | null {
  const inA =
    m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
  const inB =
    m.team_b_player_1_id === playerId || m.team_b_player_2_id === playerId;
  if (!inA && !inB) return null;
  return (inA && m.winning_team === "A") || (inB && m.winning_team === "B");
}

function matchPlayerIds(m: Match): string[] {
  return [
    m.team_a_player_1_id,
    m.team_a_player_2_id,
    m.team_b_player_1_id,
    m.team_b_player_2_id,
  ];
}

/**
 * Aggregate headline statistics for a season (or all-time when `seasonId` is
 * null). Pure — no DB access. Only real matches count; inactivity-penalty rows
 * (match_id == null) are ignored for ELO-based stats.
 */
export function computeSeasonStats(
  seasonId: string | null,
  matches: Match[],
  history: EloHistory[],
  players: Player[],
): SeasonStats {
  const nameById = new Map(players.map((p) => [p.id, p.name]));
  const seasonMatches = seasonId
    ? matches.filter((m) => m.season_id === seasonId)
    : matches;
  const seasonHistory = history.filter(
    (h) => h.match_id != null && (seasonId == null || h.season_id === seasonId),
  );

  // Games per weekday (Mon–Fri) + busiest calendar day.
  const weekday: WeekdayGames[] = WEEKDAY_LABELS.map((day) => ({
    day,
    games: 0,
  }));
  const perDay = new Map<string, number>();
  const participants = new Set<string>();
  const gamesByPlayer = new Map<string, number>();
  for (const m of seasonMatches) {
    const dow = new Date(m.created_at).getDay();
    if (dow >= 1 && dow <= 5) weekday[dow - 1].games++;
    const day = m.created_at.slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    for (const pid of matchPlayerIds(m)) {
      participants.add(pid);
      gamesByPlayer.set(pid, (gamesByPlayer.get(pid) ?? 0) + 1);
    }
  }

  let busiestDay: SeasonStats["busiestDay"] = null;
  for (const [day, games] of perDay) {
    if (!busiestDay || games > busiestDay.games) busiestDay = { day, games };
  }

  // Longest win streak across all players.
  const sorted = [...seasonMatches].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  const streaks = new Map<string, number>();
  let topStreak: SeasonStats["topStreak"] = null;
  for (const m of sorted) {
    for (const pid of matchPlayerIds(m)) {
      const won = playerWon(m, pid);
      const next = won ? (streaks.get(pid) ?? 0) + 1 : 0;
      streaks.set(pid, next);
      if (won && (!topStreak || next > topStreak.streak)) {
        topStreak = { name: nameById.get(pid) ?? "?", streak: next };
      }
    }
  }

  // Best single-day ELO gain + biggest single-match ELO gain.
  const dayGain = new Map<string, number>();
  let biggestWin: SeasonStats["biggestWin"] = null;
  for (const h of seasonHistory) {
    if (h.elo_change > 0 && (!biggestWin || h.elo_change > biggestWin.gain)) {
      biggestWin = {
        name: nameById.get(h.player_id) ?? "?",
        gain: h.elo_change,
      };
    }
    const key = `${h.player_id}:${h.created_at.slice(0, 10)}`;
    dayGain.set(key, (dayGain.get(key) ?? 0) + h.elo_change);
  }
  let bestDayGain: SeasonStats["bestDayGain"] = null;
  for (const [key, gain] of dayGain) {
    if (gain > 0 && (!bestDayGain || gain > bestDayGain.gain)) {
      const sep = key.lastIndexOf(":");
      const pid = key.slice(0, sep);
      bestDayGain = {
        name: nameById.get(pid) ?? "?",
        day: key.slice(sep + 1),
        gain,
      };
    }
  }

  return {
    gamesPlayed: seasonMatches.length,
    activePlayers: participants.size,
    weekday,
    topStreak,
    bestDayGain,
    biggestWin,
    busiestDay,
  };
}
