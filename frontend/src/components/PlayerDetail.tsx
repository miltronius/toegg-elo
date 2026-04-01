import { useState, useEffect } from "react";
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
} from "recharts";
import {
  getEloHistory,
  updatePlayerName,
  EloHistory,
  Match,
  Player,
} from "../lib/supabase";

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

function computeFriends(
  playerId: string,
  matches: Match[],
): { playerId: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of matches) {
    const inA =
      m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
    const inB =
      m.team_b_player_1_id === playerId || m.team_b_player_2_id === playerId;
    if (!inA && !inB) continue;
    const teammates = inA
      ? [m.team_a_player_1_id, m.team_a_player_2_id]
      : [m.team_b_player_1_id, m.team_b_player_2_id];
    for (const tmId of teammates) {
      if (tmId === playerId) continue;
      counts.set(tmId, (counts.get(tmId) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([pid, count]) => ({ playerId: pid, count }))
    .sort((a, b) => b.count - a.count);
}

interface PlayerDetailProps {
  player: Player;
  players: Player[];
  matches: Match[];
  onClose: () => void;
  onPlayerUpdated?: () => void;
  onNavigate?: (player: Player) => void;
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
  onClose,
  onPlayerUpdated,
  onNavigate,
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
  const h2h = computeHeadToHead(player.id, matches);
  const topFriends = computeFriends(player.id, matches).slice(0, 3);
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
  const [chartData, setChartData] = useState<{
    perGame: ChartData[];
    perDate: ChartData[];
  }>({ perGame: [], perDate: [] });
  const [xAxisMode, setXAxisMode] = useState<"game" | "date">("date");
  const [loading, setLoading] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState(player.name);
  const [isSaving, setIsSaving] = useState(false);

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
        const history: EloHistory[] = await getEloHistory(player.id);

        // Build chart data from history
        const data: ChartData[] = history
          .sort(
            (a, b) =>
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime(),
          )
          .map((entry, index) => {
            const cumulativeWins = history
              .slice(0, index + 1)
              .filter((h) => h.elo_change > 0).length;
            const cumulativeLosses = history
              .slice(0, index + 1)
              .filter((h) => h.elo_change < 0).length;
            const total = cumulativeWins + cumulativeLosses;
            const winrate = total > 0 ? (cumulativeWins / total) * 100 : 0;

            return {
              date: new Date(entry.created_at).toLocaleDateString("de-CH", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              }),
              elo: entry.elo_after,
              cumWins: cumulativeWins,
              cumLosses: cumulativeLosses,
              winrate,
            };
          });

        // Aggregate by date: keep last entry per day
        const byDate = new Map<string, ChartData>();
        for (const entry of data) {
          byDate.set(entry.date, entry);
        }
        const dateData = Array.from(byDate.values());

        setChartData({ perGame: data, perDate: dateData });
      } catch (error) {
        console.error("Failed to load player data:", error);
      } finally {
        setLoading(false);
      }
    };
    loadPlayerData();
  }, [player.id]);

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content player-detail-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="player-detail-header">
          {isEditingName ? (
            <div className="name-edit-form">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") handleSaveName();
                }}
                disabled={isSaving}
                autoFocus
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
            <h2
              onClick={() => setIsEditingName(true)}
              className="clickable-name"
            >
              {player.name}
            </h2>
          )}
          <div className="header-buttons">
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

        <div className="player-stats-grid">
          <div className="stat-card">
            <div className="stat-label">Current ELO</div>
            <div className="stat-value">{player.current_elo}</div>
          </div>
          {/*
          <div className="stat-card">
            <div className="stat-label">Total Matches</div>
            <div className="stat-value">{player.matches_played}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Win-Loss</div>
            <div className="stat-value">
              {player.wins}-{player.losses}
            </div>
          </div>
                      */}
          <div className="stat-card">
            <div className="stat-label">Winrate</div>
            <div className="stat-value">
              {player.matches_played > 0
                ? ((player.wins / player.matches_played) * 100).toFixed(1)
                : "0"}
              %
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

        {loading ? (
          <>
            <div className="chart-skeleton chart-skeleton--toggle" />
            <div className="chart-skeleton chart-skeleton--chart" />
            <div className="chart-skeleton chart-skeleton--chart" />
          </>
        ) : chartData.perGame.length === 0 ? (
          <div className="empty-state">No match history yet</div>
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

            <div className="chart-container">
              <h3>ELO Progression</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart
                  data={
                    xAxisMode === "date" ? chartData.perDate : chartData.perGame
                  }
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={["dataMin - 50", "dataMax + 50"]} />
                  <Tooltip />
                  <Legend />
                  <ReferenceLine
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
                    type="monotone"
                    dataKey="elo"
                    stroke="#3b82f6"
                    name="ELO Rating"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-container">
              <h3>Winrate Over Time</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart
                  data={
                    xAxisMode === "date" ? chartData.perDate : chartData.perGame
                  }
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 100]} label={{ value: "%" }} />
                  <Tooltip formatter={(value) => `${value.toFixed(1)}%`} />
                  <Legend />
                  <Line
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
          </>
        )}

        {(topFriends.length > 0 || topEnemies.length > 0) && (
          <div className="friends-enemies">
            {topFriends.length > 0 && (
              <div className="friends-enemies-col">
                <h3>Top Friends</h3>
                <ol className="fe-list">
                  {topFriends.map((f) => (
                    <li key={f.playerId}>
                      <span className="fe-name">{playerMap.get(f.playerId)?.name ?? "?"}</span>
                      <span className="fe-count">{f.count}×</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {topEnemies.length > 0 && (
              <div className="friends-enemies-col">
                <h3>Top Enemies</h3>
                <ol className="fe-list">
                  {topEnemies.map((e) => (
                    <li key={e.playerId}>
                      <span className="fe-name">{playerMap.get(e.playerId)?.name ?? "?"}</span>
                      <span className="fe-count">{e.wins + e.losses}×</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
