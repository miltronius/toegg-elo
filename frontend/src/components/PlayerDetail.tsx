import { useState, useEffect, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ComposedChart,
  Bar,
  LabelList,
} from "recharts";
import {
  getEloHistory,
  updatePlayerName,
  updatePlayerAnonymousName,
  EloHistory,
  Match,
  Player,
  Season,
  PlayerSeasonStats,
} from "../lib/supabase";
import { generateAnonymousName } from "../lib/anonymousNames";
import {
  computeTeammateCounts,
  buildAchievementStatuses,
  type PlayerAchievementRow,
} from "../lib/achievements";
import { computeWeekdayStats } from "../lib/weekdayStats";
import { AchievementGallery } from "./Achievements";

interface HeadToHead {
  playerId: string;
  wins: number;
  losses: number;
}

function computeHeadToHead(playerId: string, matches: Match[]): HeadToHead[] {
  const stats = new Map<string, { wins: number; losses: number }>();
  for (const m of matches) {
    const inA =
      m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
    const inB =
      m.team_b_player_1_id === playerId || m.team_b_player_2_id === playerId;
    if (!inA && !inB) continue;
    const opponents = inA
      ? [m.team_b_player_1_id, m.team_b_player_2_id]
      : [m.team_a_player_1_id, m.team_a_player_2_id];
    const won =
      (inA && m.winning_team === "A") || (inB && m.winning_team === "B");
    for (const oppId of opponents) {
      const s = stats.get(oppId) ?? { wins: 0, losses: 0 };
      if (won) s.wins++;
      else s.losses++;
      stats.set(oppId, s);
    }
  }
  return Array.from(stats.entries()).map(([pid, s]) => ({
    playerId: pid,
    ...s,
  }));
}

interface PlayerDetailProps {
  player: Player;
  players: Player[];
  matches: Match[];
  allAchievementRows: PlayerAchievementRow[];
  seasons: Season[];
  selectedSeason: Season | null;
  onSeasonSelect: (season: Season | null) => void;
  playerSeasonStats: PlayerSeasonStats[];
  onClose: () => void;
  onPlayerUpdated?: () => void;
  // Refreshes app data without closing the modal (used for inline anonymous-name edits).
  onPlayerRefresh?: () => void;
  onNavigate?: (player: Player) => void;
  initialTab?: "stats" | "achievements";
}

interface ChartData {
  date: string;
  elo: number;
  cumWins: number;
  cumLosses: number;
  winrate: number;
}

export function PlayerDetail({
  player,
  players,
  matches,
  allAchievementRows,
  seasons,
  selectedSeason,
  onSeasonSelect,
  playerSeasonStats,
  onClose,
  onPlayerUpdated,
  onPlayerRefresh,
  onNavigate,
  initialTab = "stats",
}: PlayerDetailProps) {
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const sortedPlayers = [...players].sort(
    (a, b) => b.current_elo - a.current_elo,
  );
  const currentIndex = sortedPlayers.findIndex((p) => p.id === player.id);
  const prevPlayer = currentIndex > 0 ? sortedPlayers[currentIndex - 1] : null;
  const nextPlayer =
    currentIndex < sortedPlayers.length - 1
      ? sortedPlayers[currentIndex + 1]
      : null;

  const [detailTab, setDetailTab] = useState<"stats" | "achievements">(
    initialTab,
  );
  const [rawHistory, setRawHistory] = useState<EloHistory[]>([]);
  const [xAxisMode, setXAxisMode] = useState<"game" | "date">("date");

  const currentStreak = useMemo(() => {
    const matchRows = rawHistory.filter((h) => h.match_id != null);
    let streak = 0;
    for (let i = matchRows.length - 1; i >= 0; i--) {
      if (matchRows[i].elo_change > 0) streak++;
      else break;
    }
    return streak >= 2 ? streak : 0;
  }, [rawHistory]);
  const [loading, setLoading] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState(player.name);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditingAnon, setIsEditingAnon] = useState(false);
  const [newAnon, setNewAnon] = useState(player.anonymous_name ?? "");
  const [isSavingAnon, setIsSavingAnon] = useState(false);
  // Locally tracked anonymous name so an inline save shows immediately without
  // closing the modal or waiting for the (stale) player prop to update.
  const [anonName, setAnonName] = useState(player.anonymous_name ?? "");

  // Sync initialTab when player changes (navigation)
  useEffect(() => {
    setDetailTab(initialTab);
  }, [player.id, initialTab]);

  // Reset inline editors when navigating to a different player
  useEffect(() => {
    setIsEditingName(false);
    setNewName(player.name);
    setIsEditingAnon(false);
    setNewAnon(player.anonymous_name ?? "");
    setAnonName(player.anonymous_name ?? "");
  }, [player.id, player.name, player.anonymous_name]);

  useEffect(() => {
    if (!onNavigate) return;
    const handleKey = (e: KeyboardEvent) => {
      if (isEditingName) return;
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        if (prevPlayer) onNavigate(prevPlayer);
      } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        if (nextPlayer) onNavigate(nextPlayer);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onNavigate, prevPlayer, nextPlayer, isEditingName]);

  useEffect(() => {
    const loadPlayerData = async () => {
      setLoading(true);
      try {
        const history = await getEloHistory(player.id);
        setRawHistory(
          history.sort(
            (a, b) =>
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime(),
          ),
        );
      } catch (error) {
        console.error("Failed to load player data:", error);
      } finally {
        setLoading(false);
      }
    };
    loadPlayerData();
  }, [player.id]);

  const chartData = useMemo(() => {
    const filtered = selectedSeason
      ? rawHistory.filter((h) => h.season_id === selectedSeason.id)
      : rawHistory;

    const seasonStats = selectedSeason
      ? playerSeasonStats.find(
          (s) => s.player_id === player.id && s.season_id === selectedSeason.id,
        )
      : null;
    const eloAtStart = seasonStats?.elo_at_start;

    const data: ChartData[] = filtered.map((entry, index) => {
      const cumulativeWins = filtered
        .slice(0, index + 1)
        .filter((h) => h.elo_change > 0).length;
      const cumulativeLosses = filtered
        .slice(0, index + 1)
        .filter((h) => h.elo_change < 0).length;
      const total = cumulativeWins + cumulativeLosses;
      const elo =
        eloAtStart !== undefined
          ? 1500 + (entry.elo_after - eloAtStart)
          : entry.elo_after;
      return {
        date: new Date(entry.created_at).toLocaleDateString("de-CH", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }),
        elo,
        cumWins: cumulativeWins,
        cumLosses: cumulativeLosses,
        winrate: total > 0 ? (cumulativeWins / total) * 100 : 0,
      };
    });

    const byDate = new Map<string, ChartData>();
    for (const entry of data) byDate.set(entry.date, entry);

    return { perGame: data, perDate: Array.from(byDate.values()) };
  }, [player.id, playerSeasonStats, rawHistory, selectedSeason]);

  const effectiveMatches = useMemo(
    () =>
      selectedSeason
        ? matches.filter((m) => m.season_id === selectedSeason.id)
        : matches,
    [matches, selectedSeason],
  );

  // Games + winrate per weekday (Mon–Fri), scoped to the selected season.
  const weekdayStats = useMemo(
    () => computeWeekdayStats(rawHistory, selectedSeason?.id ?? null),
    [rawHistory, selectedSeason],
  );

  // Recharts tooltips render a hardcoded white box; drive their colors from the
  // theme CSS variables so they stay legible in dark mode. --tooltip-bg and
  // --color-text are both theme-aware (defined per theme in App.css).
  const tooltipStyle = {
    contentStyle: {
      background: "var(--tooltip-bg)",
      border: "1px solid var(--bump-grid)",
      borderRadius: 8,
      color: "var(--color-text)",
    },
    labelStyle: { color: "var(--color-text)" },
  };

  const effectiveStats = useMemo(() => {
    if (!selectedSeason)
      return {
        elo: player.current_elo,
        wins: player.wins,
        losses: player.losses,
        played: player.matches_played,
      };
    const pss = playerSeasonStats.find(
      (s) => s.player_id === player.id && s.season_id === selectedSeason.id,
    );
    if (!pss) return { elo: 1500, wins: 0, losses: 0, played: 0 };
    return {
      elo: pss.current_season_elo,
      wins: pss.wins,
      losses: pss.losses,
      played: pss.wins + pss.losses,
    };
  }, [selectedSeason, player, playerSeasonStats]);

  const h2h = computeHeadToHead(player.id, effectiveMatches);
  const topFriends = Array.from(
    computeTeammateCounts(player.id, effectiveMatches).entries(),
  )
    .map(([playerId, count]) => ({ playerId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  const topEnemies = [...h2h]
    .sort((a, b) => b.wins + b.losses - (a.wins + a.losses))
    .slice(0, 3);
  const topEnemy = [...h2h]
    .sort((a, b) => b.wins - a.wins || b.wins + b.losses - (a.wins + a.losses))
    .find((h) => h.wins > 0);
  const nemesis = [...h2h]
    .sort(
      (a, b) => b.losses - a.losses || b.wins + b.losses - (a.wins + a.losses),
    )
    .find((h) => h.losses > 0);

  const handleSaveName = async () => {
    if (newName === player.name || !newName.trim()) {
      setIsEditingName(false);
      return;
    }

    setIsSaving(true);
    try {
      await updatePlayerName(player.id, newName);
      onPlayerUpdated?.();
      setIsEditingName(false);
    } catch (error) {
      alert(
        "Failed to update name: " +
          (error instanceof Error ? error.message : "Unknown error"),
      );
      setNewName(player.name);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAnon = async () => {
    const trimmed = newAnon.trim();
    if (!trimmed || trimmed === anonName) {
      setIsEditingAnon(false);
      setNewAnon(anonName);
      return;
    }

    setIsSavingAnon(true);
    try {
      await updatePlayerAnonymousName(player.id, trimmed);
      // Update the open modal immediately, then refresh app data in the
      // background without closing (admins don't see anon names elsewhere).
      setAnonName(trimmed);
      setIsEditingAnon(false);
      onPlayerRefresh?.();
    } catch (error) {
      alert(
        "Failed to update anonymous name: " +
          (error instanceof Error ? error.message : "Unknown error"),
      );
      setNewAnon(anonName);
    } finally {
      setIsSavingAnon(false);
    }
  };

  const handleRegenerateAnon = () => {
    const taken = players
      .filter((p) => p.id !== player.id)
      .map((p) => p.anonymous_name)
      .filter((n): n is string => !!n);
    setNewAnon(generateAnonymousName(player.name, taken));
  };

  const achievementStatuses = buildAchievementStatuses(
    player.id,
    player,
    players,
    matches,
    allAchievementRows,
  );

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 gap-3">
          {isEditingName ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") handleSaveName();
                }}
                disabled={isSaving}
                autoFocus
                className="flex-1 px-3 py-1.5 border border-border rounded-md text-base font-semibold focus:outline-none focus:border-primary"
              />
              <button
                onClick={handleSaveName}
                disabled={isSaving}
                className="btn-small"
              >
                {isSaving ? "..." : "✓"}
              </button>
              <button
                onClick={() => {
                  setIsEditingName(false);
                  setNewName(player.name);
                }}
                disabled={isSaving}
                className="btn-small btn-cancel"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <h2
                onClick={() => setIsEditingName(true)}
                className="text-2xl font-bold cursor-pointer hover:text-primary transition-colors m-0"
              >
                {player.name}
              </h2>
              {currentStreak > 0 && (
                <span className="streak-badge" title="Winstreak">
                  🔥{currentStreak}
                </span>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 shrink-0">
            {onNavigate && (
              <>
                <button
                  className="btn-small"
                  onClick={() => prevPlayer && onNavigate(prevPlayer)}
                  disabled={!prevPlayer}
                  title={prevPlayer ? prevPlayer.name : undefined}
                >
                  ‹
                </button>
                <button
                  className="btn-small"
                  onClick={() => nextPlayer && onNavigate(nextPlayer)}
                  disabled={!nextPlayer}
                  title={nextPlayer ? nextPlayer.name : undefined}
                >
                  ›
                </button>
              </>
            )}
            <button className="close-btn" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4 text-sm text-text-light">
          {isEditingAnon ? (
            <>
              <span title="Name shown to viewers / logged-out users">🎭</span>
              <input
                type="text"
                value={newAnon}
                onChange={(e) => setNewAnon(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveAnon();
                  if (e.key === "Escape") {
                    setIsEditingAnon(false);
                    setNewAnon(anonName);
                  }
                }}
                disabled={isSavingAnon}
                autoFocus
                className="flex-1 max-w-[260px] px-2 py-1 border border-border rounded-md text-sm focus:outline-none focus:border-primary"
              />
              <button
                onClick={handleRegenerateAnon}
                disabled={isSavingAnon}
                title="Generate a new anonymous name"
                className="btn-small"
              >
                🔁
              </button>
              <button
                onClick={handleSaveAnon}
                disabled={isSavingAnon}
                className="btn-small"
              >
                {isSavingAnon ? "..." : "✓"}
              </button>
              <button
                onClick={() => {
                  setIsEditingAnon(false);
                  setNewAnon(anonName);
                }}
                disabled={isSavingAnon}
                className="btn-small btn-cancel"
              >
                ✕
              </button>
            </>
          ) : (
            <span
              onClick={() => {
                setNewAnon(anonName);
                setIsEditingAnon(true);
              }}
              className="cursor-pointer hover:text-primary transition-colors"
              title="Anonymous name shown to viewers / logged-out users — click to edit"
            >
              🎭 {anonName || "Set anonymous name"}
            </span>
          )}
        </div>

        {seasons.length > 0 && (
          <select
            className="season-select"
            style={{ marginBottom: "0.75rem" }}
            value={selectedSeason?.id ?? ""}
            onChange={(e) => {
              const s = seasons.find((s) => s.id === e.target.value) ?? null;
              onSeasonSelect(s);
            }}
          >
            <option value="">All-Time</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                S{s.number} · {s.name}
              </option>
            ))}
          </select>
        )}

        <div className="player-stats-grid">
          <div className="stat-card">
            <div className="stat-label">
              {selectedSeason ? "Season ELO" : "Current ELO"}
            </div>
            <div className="stat-value">{effectiveStats.elo}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Winrate</div>
            <div className="stat-value">
              {effectiveStats.played > 0
                ? ((effectiveStats.wins / effectiveStats.played) * 100).toFixed(
                    1,
                  )
                : "0"}
              %
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">W - L</div>
            <div className="stat-value" style={{ fontSize: "1.1rem" }}>
              {effectiveStats.wins} - {effectiveStats.losses}
            </div>
          </div>
          {topEnemy && (
            <div className="stat-card">
              <div className="stat-label">Favorite Enemy</div>
              <div className="stat-value stat-value--name">
                {playerMap.get(topEnemy.playerId)?.name ?? "?"}
              </div>
              <div className="stat-sub">
                {topEnemy.wins} – {topEnemy.losses}
              </div>
            </div>
          )}
          {nemesis && (
            <div className="stat-card">
              <div className="stat-label">Nemesis</div>
              <div className="stat-value stat-value--name">
                {playerMap.get(nemesis.playerId)?.name ?? "?"}
              </div>
              <div className="stat-sub">
                {nemesis.wins} – {nemesis.losses}
              </div>
            </div>
          )}
        </div>

        {/* Tab toggle */}
        <div
          className="lb-toggle"
          style={{ width: "fit-content", marginBottom: "0.75rem" }}
        >
          <button
            className={`lb-toggle-btn${detailTab === "stats" ? " active" : ""}`}
            onClick={() => setDetailTab("stats")}
          >
            📊 Stats
          </button>
          <button
            className={`lb-toggle-btn${detailTab === "achievements" ? " active" : ""}`}
            onClick={() => setDetailTab("achievements")}
          >
            🏅 Achievements
          </button>
        </div>

        {detailTab === "stats" && (
          <>
            {loading ? (
              <>
                <div className="chart-skeleton h-8 mb-4 rounded-md" />
                <div className="chart-skeleton h-75 mb-4 rounded-md" />
                <div className="chart-skeleton h-75 mb-4 rounded-md" />
              </>
            ) : chartData.perGame.length === 0 ? (
              <div className="text-center text-text-light py-8">
                No match history yet
              </div>
            ) : (
              <>
                <div className="lb-toggle" style={{ width: "fit-content" }}>
                  <button
                    className={`lb-toggle-btn${xAxisMode === "date" ? " active" : ""}`}
                    onClick={() => setXAxisMode("date")}
                  >
                    Per Date
                  </button>
                  <button
                    className={`lb-toggle-btn${xAxisMode === "game" ? " active" : ""}`}
                    onClick={() => setXAxisMode("game")}
                  >
                    Per Game
                  </button>
                </div>

                <div className="mb-6">
                  <h3>ELO &amp; Winrate Over Time</h3>
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart
                      data={
                        xAxisMode === "date"
                          ? chartData.perDate
                          : chartData.perGame
                      }
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis
                        yAxisId="elo"
                        domain={["dataMin - 50", "dataMax + 50"]}
                      />
                      <YAxis
                        yAxisId="winrate"
                        orientation="right"
                        domain={[0, 100]}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip
                        {...tooltipStyle}
                        formatter={(value, name) =>
                          name === "Winrate %"
                            ? `${(value as number).toFixed(1)}%`
                            : value
                        }
                      />
                      <Legend />
                      <ReferenceLine
                        yAxisId="elo"
                        y={1500}
                        stroke="#f59e0b"
                        strokeDasharray="6 4"
                        strokeWidth={1.5}
                        label={{
                          value: "1500",
                          position: "insideTopRight",
                          fill: "#f59e0b",
                          fontSize: 12,
                          dy: -20,
                        }}
                      />
                      <Line
                        yAxisId="elo"
                        type="monotone"
                        dataKey="elo"
                        stroke="#3b82f6"
                        name="ELO Rating"
                        dot={false}
                        strokeWidth={2}
                      />
                      <Line
                        yAxisId="winrate"
                        type="monotone"
                        dataKey="winrate"
                        stroke="#10b981"
                        name="Winrate %"
                        dot={false}
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="mb-6">
                  <h3>Games by Weekday</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={weekdayStats}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" />
                      <YAxis
                        yAxisId="games"
                        allowDecimals={false}
                        label={{
                          value: "Games",
                          angle: -90,
                          position: "insideLeft",
                        }}
                      />
                      <YAxis
                        yAxisId="winrate"
                        orientation="right"
                        domain={[0, 100]}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip
                        {...tooltipStyle}
                        formatter={(value, name) =>
                          name === "Winrate %"
                            ? [
                                value == null
                                  ? "—"
                                  : `${(value as number).toFixed(1)}%`,
                                name,
                              ]
                            : [value as number, name]
                        }
                      />
                      <Legend />
                      <Bar
                        yAxisId="games"
                        dataKey="games"
                        name="Games"
                        fill="#3b82f6"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={56}
                      />
                      <Line
                        yAxisId="winrate"
                        type="monotone"
                        dataKey="winrate"
                        name="Winrate %"
                        stroke="#10b981"
                        strokeWidth={2}
                        connectNulls={false}
                        dot={{ r: 3 }}
                      >
                        <LabelList
                          dataKey="winrate"
                          position="top"
                          formatter={(value: number | null) =>
                            value == null ? "" : `${Math.round(value)}%`
                          }
                          style={{ fill: "#10b981", fontSize: 11 }}
                        />
                      </Line>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}

            {(topFriends.length > 0 || topEnemies.length > 0) && (
              <div className="grid grid-cols-2 gap-4 mt-4">
                {topFriends.length > 0 && (
                  <div>
                    <h3>Top Friends</h3>
                    <ol className="fe-list">
                      {topFriends.map((f) => (
                        <li key={f.playerId}>
                          <span className="flex-1">
                            {playerMap.get(f.playerId)?.name ?? "?"}
                          </span>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-bg-light border border-border text-xs font-semibold text-text-light">
                            {f.count}×
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {topEnemies.length > 0 && (
                  <div>
                    <h3>Top Enemies</h3>
                    <ol className="fe-list">
                      {topEnemies.map((e) => (
                        <li key={e.playerId}>
                          <span className="flex-1">
                            {playerMap.get(e.playerId)?.name ?? "?"}
                          </span>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-bg-light border border-border text-xs font-semibold text-text-light">
                            {e.wins + e.losses}×
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {detailTab === "achievements" && (
          <AchievementGallery
            statuses={achievementStatuses}
            players={players}
            playerId={player.id}
            matches={matches}
          />
        )}
      </div>
    </div>
  );
}
