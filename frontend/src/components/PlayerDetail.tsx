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
} from "recharts";
import {
  getEloHistory,
  deletePlayer,
  updatePlayerName,
  Match,
  Player,
} from "../lib/supabase";

interface PlayerDetailProps {
  player: Player;
  matches: Match[];
  onClose: () => void;
  onPlayerUpdated?: () => void;
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
  matches,
  onClose,
  onPlayerUpdated,
}: PlayerDetailProps) {
  const [eloHistory, setEloHistory] = useState<any[]>([]);
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState(player.name);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadPlayerData();
  }, [player.id]);

  const loadPlayerData = async () => {
    setLoading(true);
    try {
      const history = await getEloHistory(player.id);
      setEloHistory(history);

      // Build chart data from history
      const data: ChartData[] = history
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
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
            date: new Date(entry.created_at).toLocaleDateString(),
            elo: entry.elo_after,
            cumWins: cumulativeWins,
            cumLosses: cumulativeLosses,
            winrate,
          };
        });

      setChartData(data);
    } catch (error) {
      console.error("Failed to load player data:", error);
    } finally {
      setLoading(false);
    }
  };

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

  const handleDeletePlayer = async () => {
    if (
      !confirm(
        `Delete player "${player.name}"? This will remove all their matches and stats.`,
      )
    ) {
      return;
    }

    try {
      await deletePlayer(player.id);
      onPlayerUpdated?.();
      onClose();
    } catch (error) {
      alert(
        "Failed to delete player: " +
          (error instanceof Error ? error.message : "Unknown error"),
      );
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
            <button className="close-btn" onClick={onClose}>
              ✕
            </button>
            <button className="btn-delete-sm" onClick={handleDeletePlayer}>
              🗑️
            </button>
          </div>
        </div>

        <div className="player-stats-grid">
          <div className="stat-card">
            <div className="stat-label">Current ELO</div>
            <div className="stat-value">{player.current_elo}</div>
          </div>
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
          <div className="stat-card">
            <div className="stat-label">Winrate</div>
            <div className="stat-value">
              {player.matches_played > 0
                ? ((player.wins / player.matches_played) * 100).toFixed(1)
                : "0"}
              %
            </div>
          </div>
        </div>

        {loading ? (
          <div className="loading-state">Loading charts...</div>
        ) : chartData.length === 0 ? (
          <div className="empty-state">No match history yet</div>
        ) : (
          <>
            <div className="chart-container">
              <h3>ELO Progression</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={["dataMin - 50", "dataMax + 50"]} />
                  <Tooltip />
                  <Legend />
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
                <LineChart data={chartData}>
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
      </div>
    </div>
  );
}
