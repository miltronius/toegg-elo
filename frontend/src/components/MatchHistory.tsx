import { useState } from "react";
import { Match, Player, EloHistory, deleteMatch } from "../lib/supabase";

interface MatchHistoryProps {
  matches: Match[];
  players: Player[];
  eloHistory: Map<string, EloHistory[]>;
  onMatchDeleted?: () => void;
}

export function MatchHistory({
  matches,
  players,
  eloHistory,
  onMatchDeleted,
}: MatchHistoryProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const playerMap = new Map(players.map((p) => [p.id, p]));

  const handleDeleteMatch = async (matchId: string) => {
    if (!confirm("Delete this match?")) return;

    setDeletingId(matchId);
    try {
      await deleteMatch(matchId);
      onMatchDeleted?.();
    } catch (error) {
      alert(
        "Failed to delete match: " +
          (error instanceof Error ? error.message : "Unknown error"),
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="card">
      <h2>Match History</h2>
      {matches.length === 0 ? (
        <p className="empty-state">
          No matches recorded yet. Record a match to get started!
        </p>
      ) : (
        <div className="match-history-list">
          {matches.map((match) => {
            const teamA1 = playerMap.get(match.team_a_player_1_id);
            const teamA2 = playerMap.get(match.team_a_player_2_id);
            const teamB1 = playerMap.get(match.team_b_player_1_id);
            const teamB2 = playerMap.get(match.team_b_player_2_id);

            const teamAWon = match.winning_team === "A";

            const getEloChange = (playerId: string) => {
              const playerHistory = eloHistory.get(playerId) || [];
              const matchHistory = playerHistory.find(
                (h) => h.match_id === match.id,
              );
              return matchHistory;
            };

            const renderPlayerEloDetails = (
              playerId: string,
              playerName: string | undefined,
            ) => {
              const history = getEloChange(playerId);
              if (!history) return null;

              const change = history.elo_after - history.elo_before;
              const changePercent = (
                (change / history.elo_before) *
                100
              ).toFixed(1);

              return (
                <div className="player-elo-details">
                  <span className="player-name">{playerName}</span>
                  <span className="elo-before">{history.elo_before}</span>
                  <span className="elo-arrow">→</span>
                  <span
                    className={`elo-after ${change > 0 ? "positive" : "negative"}`}
                  >
                    {history.elo_after}
                  </span>
                  <span
                    className={`elo-change-detail ${change > 0 ? "positive" : "negative"}`}
                  >
                    {change > 0 ? "+" : ""}
                    {change} ({changePercent}%)
                  </span>
                </div>
              );
            };

            return (
              <div key={match.id} className="match-card">
                <div className="match-teams">
                  <div className={`team ${teamAWon ? "winner" : "loser"}`}>
                    <div className="team-name">Team A {teamAWon && "✓"}</div>
                    <div className="team-players">
                      {renderPlayerEloDetails(
                        match.team_a_player_1_id,
                        teamA1?.name,
                      )}
                      {renderPlayerEloDetails(
                        match.team_a_player_2_id,
                        teamA2?.name,
                      )}
                    </div>
                  </div>

                  <div className="match-divider">vs</div>

                  <div className={`team ${!teamAWon ? "winner" : "loser"}`}>
                    <div className="team-name">Team B {!teamAWon && "✓"}</div>
                    <div className="team-players">
                      {renderPlayerEloDetails(
                        match.team_b_player_1_id,
                        teamB1?.name,
                      )}
                      {renderPlayerEloDetails(
                        match.team_b_player_2_id,
                        teamB2?.name,
                      )}
                    </div>
                  </div>
                </div>
                <div className="match-footer">
                  <div className="match-time">
                    {new Date(match.created_at).toLocaleString()}
                  </div>
                  <button
                    className="btn-delete"
                    onClick={() => handleDeleteMatch(match.id)}
                    disabled={deletingId === match.id}
                  >
                    {deletingId === match.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
