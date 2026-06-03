import type { Match, Player, EloHistory } from "./supabase";
import type { PlayerAchievementRow } from "./achievements";

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
  /** Per-calendar-day match counts (days with ≥1 match), ascending by day. */
  activity: { day: string; games: number }[];
  /** First and last calendar day with a match in scope, or null when empty. */
  dateRange: { start: string; end: string } | null;
  /** Player with the longest run of consecutive wins. */
  topStreak: { name: string; streak: number } | null;
  /** Player with the longest run of consecutive losses. */
  topLoseStreak: { name: string; streak: number } | null;
  /** Best net ELO gained by a single player on a single calendar day. */
  bestDayGain: { name: string; day: string; gain: number } | null;
  /** Largest ELO gain from a single match. */
  biggestWin: { name: string; gain: number } | null;
  /** Worst net ELO lost by a single player on a single calendar day. */
  worstDayDrop: { name: string; day: string; drop: number } | null;
  /** Largest ELO drop from a single match. */
  biggestLoss: { name: string; drop: number } | null;
  /** Highest ELO score any player reached in scope (season-normalized for a season). */
  highestElo: { name: string; elo: number } | null;
  /** Lowest ELO score any player reached in scope (season-normalized for a season). */
  lowestElo: { name: string; elo: number } | null;
  /** Calendar day with the most matches. */
  busiestDay: { day: string; games: number } | null;
  /** Best win % among players with at least `minGames` games. */
  winRateLeader: {
    name: string;
    winrate: number;
    games: number;
    minGames: number;
  } | null;
  /** Achievements unlocked in scope (this season, or all-time). */
  achievementsUnlocked: number;
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
  achievements: PlayerAchievementRow[] = [],
  seasonBounds: { startedAt: string; endedAt: string | null } | null = null,
): SeasonStats {
  const nameById = new Map(players.map((p) => [p.id, p.name]));
  const seasonMatches = seasonId
    ? matches.filter((m) => m.season_id === seasonId)
    : matches;
  const seasonHistory = history.filter(
    (h) => h.match_id != null && (seasonId == null || h.season_id === seasonId),
  );

  // Games per weekday (Mon–Fri) + busiest calendar day, games & wins per player.
  const weekday: WeekdayGames[] = WEEKDAY_LABELS.map((day) => ({
    day,
    games: 0,
  }));
  const perDay = new Map<string, number>();
  const participants = new Set<string>();
  const gamesByPlayer = new Map<string, number>();
  const winsByPlayer = new Map<string, number>();
  for (const m of seasonMatches) {
    const dow = new Date(m.created_at).getDay();
    if (dow >= 1 && dow <= 5) weekday[dow - 1].games++;
    const day = m.created_at.slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    for (const pid of matchPlayerIds(m)) {
      participants.add(pid);
      gamesByPlayer.set(pid, (gamesByPlayer.get(pid) ?? 0) + 1);
      if (playerWon(m, pid)) {
        winsByPlayer.set(pid, (winsByPlayer.get(pid) ?? 0) + 1);
      }
    }
  }

  let busiestDay: SeasonStats["busiestDay"] = null;
  for (const [day, games] of perDay) {
    if (!busiestDay || games > busiestDay.games) busiestDay = { day, games };
  }

  const activity = [...perDay.entries()]
    .map(([day, games]) => ({ day, games }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const dateRange =
    activity.length > 0
      ? { start: activity[0].day, end: activity[activity.length - 1].day }
      : null;

  // Longest win and lose streaks across all players.
  const sorted = [...seasonMatches].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  const streaks = new Map<string, number>();
  const loseStreaks = new Map<string, number>();
  let topStreak: SeasonStats["topStreak"] = null;
  let topLoseStreak: SeasonStats["topLoseStreak"] = null;
  for (const m of sorted) {
    for (const pid of matchPlayerIds(m)) {
      const won = playerWon(m, pid);
      const next = won ? (streaks.get(pid) ?? 0) + 1 : 0;
      streaks.set(pid, next);
      if (won && (!topStreak || next > topStreak.streak)) {
        topStreak = { name: nameById.get(pid) ?? "?", streak: next };
      }
      const nextLose = won ? 0 : (loseStreaks.get(pid) ?? 0) + 1;
      loseStreaks.set(pid, nextLose);
      if (!won && (!topLoseStreak || nextLose > topLoseStreak.streak)) {
        topLoseStreak = { name: nameById.get(pid) ?? "?", streak: nextLose };
      }
    }
  }

  // Per-player season-start all-time ELO (the elo_before of their first match
  // in scope), used to season-normalize absolute ELO scores: 1500 + (alltime -
  // start). For all-time scope we report raw all-time ELO instead.
  const startById = new Map<string, { at: string; elo: number }>();
  for (const h of seasonHistory) {
    const cur = startById.get(h.player_id);
    if (!cur || h.created_at < cur.at) {
      startById.set(h.player_id, { at: h.created_at, elo: h.elo_before });
    }
  }
  const normElo = (pid: string, alltime: number): number =>
    seasonId == null ? alltime : 1500 + (alltime - (startById.get(pid)?.elo ?? alltime));

  // Best/worst single-day net ELO swing + biggest single-match gain/drop +
  // highest/lowest ELO score reached.
  const dayGain = new Map<string, number>();
  let biggestWin: SeasonStats["biggestWin"] = null;
  let biggestLoss: SeasonStats["biggestLoss"] = null;
  let highestElo: SeasonStats["highestElo"] = null;
  let lowestElo: SeasonStats["lowestElo"] = null;
  for (const h of seasonHistory) {
    const name = nameById.get(h.player_id) ?? "?";
    if (h.elo_change > 0 && (!biggestWin || h.elo_change > biggestWin.gain)) {
      biggestWin = { name, gain: h.elo_change };
    }
    if (h.elo_change < 0 && (!biggestLoss || -h.elo_change > biggestLoss.drop)) {
      biggestLoss = { name, drop: -h.elo_change };
    }
    const elo = normElo(h.player_id, h.elo_after);
    if (!highestElo || elo > highestElo.elo) highestElo = { name, elo };
    if (!lowestElo || elo < lowestElo.elo) lowestElo = { name, elo };
    const key = `${h.player_id}:${h.created_at.slice(0, 10)}`;
    dayGain.set(key, (dayGain.get(key) ?? 0) + h.elo_change);
  }
  let bestDayGain: SeasonStats["bestDayGain"] = null;
  let worstDayDrop: SeasonStats["worstDayDrop"] = null;
  for (const [key, gain] of dayGain) {
    const sep = key.lastIndexOf(":");
    const pid = key.slice(0, sep);
    const day = key.slice(sep + 1);
    if (gain > 0 && (!bestDayGain || gain > bestDayGain.gain)) {
      bestDayGain = { name: nameById.get(pid) ?? "?", day, gain };
    }
    if (gain < 0 && (!worstDayDrop || -gain > worstDayDrop.drop)) {
      worstDayDrop = { name: nameById.get(pid) ?? "?", day, drop: -gain };
    }
  }

  // Win-rate leader among players with enough games to be meaningful. The
  // threshold scales with the most active player (half their games, min 3).
  const maxGames = Math.max(0, ...gamesByPlayer.values());
  const minGames = Math.max(3, Math.ceil(maxGames / 2));
  let winRateLeader: SeasonStats["winRateLeader"] = null;
  for (const [pid, games] of gamesByPlayer) {
    if (games < minGames) continue;
    const winrate = ((winsByPlayer.get(pid) ?? 0) / games) * 100;
    if (
      !winRateLeader ||
      winrate > winRateLeader.winrate ||
      (winrate === winRateLeader.winrate && games > winRateLeader.games)
    ) {
      winRateLeader = { name: nameById.get(pid) ?? "?", winrate, games, minGames };
    }
  }

  // Achievements unlocked: all-time = every row; per-season = rows whose
  // unlocked_at falls inside the season's [startedAt, endedAt) window.
  const achievementsUnlocked =
    seasonId == null
      ? achievements.length
      : seasonBounds
        ? achievements.filter(
            (a) =>
              a.unlocked_at >= seasonBounds.startedAt &&
              (seasonBounds.endedAt == null ||
                a.unlocked_at < seasonBounds.endedAt),
          ).length
        : 0;

  return {
    gamesPlayed: seasonMatches.length,
    activePlayers: participants.size,
    weekday,
    activity,
    dateRange,
    topStreak,
    topLoseStreak,
    bestDayGain,
    biggestWin,
    worstDayDrop,
    biggestLoss,
    highestElo,
    lowestElo,
    busiestDay,
    winRateLeader,
    achievementsUnlocked,
  };
}
