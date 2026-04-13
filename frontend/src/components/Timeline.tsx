import { useMemo } from "react";
import { Player, Match, EloHistory, Season } from "../lib/supabase";
import type { PlayerAchievementRow } from "../lib/achievements";
import { ACHIEVEMENT_DEFINITIONS } from "../lib/achievements";

interface DashboardProps {
  players: Player[];
  matches: Match[];
  eloHistory: Map<string, EloHistory[]>;
  allAchievementRows: PlayerAchievementRow[];
  seasons: Season[];
}

type MatchEvent = {
  type: "match";
  time: string;
  match: Match;
  eloChanges: EloHistory[];
};

type AchievementEvent = {
  type: "achievement";
  time: string;
  row: PlayerAchievementRow;
};

type RankChangeEvent = {
  type: "rank_change";
  playerId: string;
  fromRank: number;
  toRank: number;
};

type FirstGameEvent = {
  type: "first_game";
  playerId: string;
  rank: number;
};

type SeasonTransitionEvent = {
  type: "season_transition";
  endedSeason: Season;
  startedSeason: Season;
};

type EventGroup =
  | { kind: "season"; event: SeasonTransitionEvent }
  | { kind: "matches"; events: MatchEvent[] }
  | { kind: "achievements"; events: AchievementEvent[] }
  | { kind: "rankings"; events: (RankChangeEvent | FirstGameEvent)[] };

type DaySection = {
  date: string;
  groups: EventGroup[];
};

function buildTimeline(
  players: Player[],
  matches: Match[],
  eloHistory: Map<string, EloHistory[]>,
  allAchievementRows: PlayerAchievementRow[],
  seasons: Season[],
): DaySection[] {
  if (matches.length === 0) return [];

  // Build season transition lookup: date → { ended, started }
  const sortedSeasons = [...seasons].sort((a, b) => a.number - b.number);
  const transitionByDate = new Map<string, SeasonTransitionEvent>();
  for (const s of sortedSeasons) {
    if (!s.ended_at) continue;
    const next = sortedSeasons.find((ns) => ns.number === s.number + 1);
    if (!next) continue;
    const day = s.ended_at.slice(0, 10);
    transitionByDate.set(day, { type: "season_transition", endedSeason: s, startedSeason: next });
  }

  // Build match-id → elo entries lookup
  const historyByMatchId = new Map<string, EloHistory[]>();
  for (const entries of eloHistory.values()) {
    for (const entry of entries) {
      if (!entry.match_id) continue;
      const arr = historyByMatchId.get(entry.match_id) ?? [];
      arr.push(entry);
      historyByMatchId.set(entry.match_id, arr);
    }
  }

  // Build flat elo history sorted ASC, excluding inactivity penalties
  const allEntries = Array.from(eloHistory.values())
    .flat()
    .filter((e) => e.match_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Group entries by date
  const entriesByDate = new Map<string, EloHistory[]>();
  for (const entry of allEntries) {
    const day = entry.created_at.slice(0, 10);
    const arr = entriesByDate.get(day) ?? [];
    arr.push(entry);
    entriesByDate.set(day, arr);
  }

  // Group matches by date
  const matchesByDate = new Map<string, Match[]>();
  for (const m of matches) {
    const day = m.created_at.slice(0, 10);
    const arr = matchesByDate.get(day) ?? [];
    arr.push(m);
    matchesByDate.set(day, arr);
  }

  // Group achievements by date
  const achievementsByDate = new Map<string, PlayerAchievementRow[]>();
  for (const row of allAchievementRows) {
    const day = row.unlocked_at.slice(0, 10);
    const arr = achievementsByDate.get(day) ?? [];
    arr.push(row);
    achievementsByDate.set(day, arr);
  }

  // Season ELO reconstruction — keyed by season_id, each player starts at 1500
  const seasonElos = new Map<string, Map<string, number>>();

  const getSeasonElos = (seasonId: string): Map<string, number> => {
    if (!seasonElos.has(seasonId)) {
      seasonElos.set(seasonId, new Map(players.map((p) => [p.id, 1500])));
    }
    return seasonElos.get(seasonId)!;
  };

  const activeDates = [...matchesByDate.keys()].sort();
  const rankChangesForDay = new Map<string, (RankChangeEvent | FirstGameEvent)[]>();
  // Track which players have played at least once per season
  const activePlayers = new Map<string, Set<string>>();

  const getActivePlayers = (seasonId: string): Set<string> => {
    if (!activePlayers.has(seasonId)) activePlayers.set(seasonId, new Set());
    return activePlayers.get(seasonId)!;
  };

  for (const date of activeDates) {
    // Determine the season for this day from the first match
    const seasonId = matchesByDate.get(date)?.[0]?.season_id ?? null;
    if (!seasonId) continue;

    const elosForSeason = getSeasonElos(seasonId);
    const seasonActivePlayers = getActivePlayers(seasonId);

    // Rank before applying today's changes (active players only)
    const rankBefore = new Map<string, number>();
    [...elosForSeason.entries()]
      .filter(([id]) => seasonActivePlayers.has(id))
      .sort((a, b) => b[1] - a[1])
      .forEach(([id], i) => rankBefore.set(id, i + 1));

    // Apply all elo changes for this day (season-filtered entries only)
    for (const entry of entriesByDate.get(date) ?? []) {
      if (entry.season_id !== seasonId) continue;
      const current = elosForSeason.get(entry.player_id) ?? 1500;
      const delta = entry.elo_after - entry.elo_before;
      elosForSeason.set(entry.player_id, current + delta);
      seasonActivePlayers.add(entry.player_id);
    }

    // Rank after (active players only)
    const rankAfter = new Map<string, number>();
    [...elosForSeason.entries()]
      .filter(([id]) => seasonActivePlayers.has(id))
      .sort((a, b) => b[1] - a[1])
      .forEach(([id], i) => rankAfter.set(id, i + 1));

    const events: (RankChangeEvent | FirstGameEvent)[] = [];
    for (const player of players) {
      const after = rankAfter.get(player.id);
      const before = rankBefore.get(player.id);
      if (after === undefined) continue;
      if (before === undefined) {
        // First game this season
        events.push({ type: "first_game", playerId: player.id, rank: after });
      } else if (before !== after) {
        events.push({ type: "rank_change", playerId: player.id, fromRank: before, toRank: after });
      }
    }
    // Sort: best ranks (lowest number) first
    events.sort((a, b) => {
      const rankA = a.type === "first_game" ? a.rank : a.toRank;
      const rankB = b.type === "first_game" ? b.rank : b.toRank;
      return rankA - rankB;
    });
    if (events.length > 0) rankChangesForDay.set(date, events);
  }

  // Collect all dates: match days + season transition days
  const allDates = [...new Set([...activeDates, ...transitionByDate.keys()])].sort();

  // Build day sections (newest first)
  const daySections: DaySection[] = [];

  for (const date of [...allDates].reverse()) {
    const groups: EventGroup[] = [];

    // Matches group (sorted newest first within day)
    const dayMatches = (matchesByDate.get(date) ?? [])
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (dayMatches.length > 0) {
      groups.push({
        kind: "matches",
        events: dayMatches.map((match) => ({
          type: "match" as const,
          time: match.created_at,
          match,
          eloChanges: historyByMatchId.get(match.id) ?? [],
        })),
      });
    }

    // Season transition (shown first)
    const transition = transitionByDate.get(date);
    if (transition) groups.unshift({ kind: "season", event: transition });

    // Rankings group
    const dayRankChanges = rankChangesForDay.get(date) ?? [];
    if (dayRankChanges.length > 0) {
      groups.push({ kind: "rankings", events: dayRankChanges });
    }

    // Achievements group
    const dayAchievements = achievementsByDate.get(date) ?? [];
    if (dayAchievements.length > 0) {
      groups.push({
        kind: "achievements",
        events: dayAchievements.map((row) => ({
          type: "achievement" as const,
          time: row.unlocked_at,
          row,
        })),
      });
    }

    if (groups.length > 0) daySections.push({ date, groups });
  }

  return daySections;
}

function formatDay(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  if (date === today) return "Today";
  if (date === yesterday) return "Yesterday";
  return d.toLocaleDateString("de-CH", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
}

const GROUP_LABELS: Record<EventGroup["kind"], string> = {
  season: "",
  matches: "Matches",
  achievements: "Achievements",
  rankings: "Rankings",
};

export function Timeline({
  players,
  matches,
  eloHistory,
  allAchievementRows,
  seasons,
}: DashboardProps) {
  const playerMap = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const daySections = useMemo(
    () => buildTimeline(players, matches, eloHistory, allAchievementRows, seasons),
    [players, matches, eloHistory, allAchievementRows, seasons],
  );

  if (daySections.length === 0) {
    return (
      <div className="card">
        <h2>Timeline</h2>
        <p className="empty-state">No matches recorded yet. Record a match to get started!</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Timeline</h2>
      <div className="dashboard-timeline">
        {daySections.map((day) => (
          <div key={day.date} className="dashboard-day">
            <div className="dashboard-day-header">{formatDay(day.date)}</div>
            <div className="dashboard-groups">
              {day.groups.map((group) => (
                <div key={group.kind} className="dashboard-group">
                  <div className="dashboard-group-label">{GROUP_LABELS[group.kind]}</div>
                  <div className="dashboard-events">
                    {group.kind === "matches" &&
                      group.events.map((event, i) => {
                        const m = event.match;
                        const aWon = m.winning_team === "A";
                        const winners = aWon
                          ? [m.team_a_player_1_id, m.team_a_player_2_id]
                          : [m.team_b_player_1_id, m.team_b_player_2_id];
                        const losers = aWon
                          ? [m.team_b_player_1_id, m.team_b_player_2_id]
                          : [m.team_a_player_1_id, m.team_a_player_2_id];

                        const renderPlayer = (id: string, isWinner: boolean) => {
                          const name = playerMap.get(id)?.name ?? "?";
                          const h = event.eloChanges.find((e) => e.player_id === id);
                          const delta = h ? h.elo_after - h.elo_before : null;
                          return (
                            <span key={id} className="dashboard-player-inline">
                              <span className={isWinner ? "dashboard-match-winner" : "dashboard-match-loser"}>{name}</span>
                              {delta !== null && (
                                <span className={`dashboard-elo-delta ${delta >= 0 ? "positive" : "negative"}`}>
                                  {delta >= 0 ? "+" : ""}{delta}
                                </span>
                              )}
                            </span>
                          );
                        };

                        return (
                          <div key={i} className="dashboard-event">
                            <span className="dashboard-event-icon">⚽</span>
                            <span className="dashboard-event-time">{formatTime(event.time)}</span>
                            <span className="dashboard-event-body">
                              {winners.map((id, j) => (
                                <span key={id}>
                                  {j > 0 && <span className="dashboard-match-sep"> & </span>}
                                  {renderPlayer(id, true)}
                                </span>
                              ))}
                              <span className="dashboard-match-vs"> won vs </span>
                              {losers.map((id, j) => (
                                <span key={id}>
                                  {j > 0 && <span className="dashboard-match-sep"> & </span>}
                                  {renderPlayer(id, false)}
                                </span>
                              ))}
                            </span>
                          </div>
                        );
                      })}

                    {group.kind === "achievements" &&
                      group.events.map((event, i) => {
                        const def = ACHIEVEMENT_DEFINITIONS.find((d) => d.id === event.row.achievement_id);
                        const playerName = playerMap.get(event.row.player_id)?.name ?? "?";
                        return (
                          <div key={i} className="dashboard-event">
                            <span className="dashboard-event-icon">{def?.icon ?? "🏅"}</span>
                            <span className="dashboard-event-time">{formatTime(event.time)}</span>
                            <span className="dashboard-event-body">
                              <span className="dashboard-match-winner">{playerName}</span>
                              {" earned "}
                              <span className="dashboard-achievement-name">"{def?.name ?? event.row.achievement_id}"</span>
                            </span>
                          </div>
                        );
                      })}

                    {group.kind === "season" && (
                      <div className="dashboard-event dashboard-season-transition">
                        <span className="dashboard-event-icon">🏆</span>
                        <span className="dashboard-event-time" />
                        <span className="dashboard-event-body">
                          <span className="dashboard-season-label">S{group.event.endedSeason.number} · {group.event.endedSeason.name} ended</span>
                          <span className="dashboard-match-sep"> · </span>
                          <span className="dashboard-season-label">S{group.event.startedSeason.number} · {group.event.startedSeason.name} started</span>
                        </span>
                      </div>
                    )}

                    {group.kind === "rankings" &&
                      group.events.map((event, i) => {
                        const playerName = playerMap.get(event.playerId)?.name ?? "?";
                        if (event.type === "first_game") {
                          return (
                            <div key={i} className="dashboard-event">
                              <span className="dashboard-event-icon">⭐</span>
                              <span className="dashboard-event-time" />
                              <span className="dashboard-event-body">
                                <span className="dashboard-match-winner">{playerName}</span>
                                {" had their first game this season! Ranked "}
                                <span className="dashboard-rank">#{event.rank}</span>
                              </span>
                            </div>
                          );
                        }
                        const movedUp = event.fromRank > event.toRank;
                        return (
                          <div key={i} className="dashboard-event">
                            <span className="dashboard-event-icon">{movedUp ? "📈" : "📉"}</span>
                            <span className="dashboard-event-time" />
                            <span className="dashboard-event-body">
                              <span className="dashboard-match-winner">{playerName}</span>
                              {movedUp ? " moved up from " : " dropped from "}
                              <span className="dashboard-rank">#{event.fromRank}</span>
                              {" to "}
                              <span className="dashboard-rank">#{event.toRank}</span>
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
