import { useState, useMemo } from "react";
import { recordMatch, Player, PlayerSeasonStats } from "../lib/supabase";
import { PlayerDropdown } from "./PlayerModal";

interface MatchFormProps {
  players: Player[];
  onMatchRecorded: () => void;
  playerSeasonStats?: PlayerSeasonStats[];
}

export function MatchForm({ players, onMatchRecorded, playerSeasonStats = [] }: MatchFormProps) {
  const seasonEloMap = useMemo(
    () => new Map(playerSeasonStats.map((s) => [s.player_id, s.current_season_elo])),
    [playerSeasonStats],
  );

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => {
      const eloA = seasonEloMap.get(a.id) ?? a.current_elo;
      const eloB = seasonEloMap.get(b.id) ?? b.current_elo;
      return eloB - eloA;
    }),
    [players, seasonEloMap],
  );
  const [teamA1, setTeamA1] = useState("");
  const [teamA2, setTeamA2] = useState("");
  const [teamB1, setTeamB1] = useState("");
  const [teamB2, setTeamB2] = useState("");
  const [winner, setWinner] = useState<"A" | "B" | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!teamA1 || !teamA2 || !teamB1 || !teamB2 || !winner) {
      setError("Please select all players and a winner");
      return;
    }

    if (teamA1 === teamA2 || teamB1 === teamB2) {
      setError("Players must be different");
      return;
    }

    if (
      [teamA1, teamA2, teamB1, teamB2].some(
        (p) =>
          [teamA1, teamA2, teamB1, teamB2].filter((x) => x === p).length > 1,
      )
    ) {
      setError("Each player can only be in one team");
      return;
    }

    setLoading(true);

    try {
      await recordMatch(teamA1, teamA2, teamB1, teamB2, winner as "A" | "B");
      setSuccess(true);
      setTeamA1("");
      setTeamA2("");
      setTeamB1("");
      setTeamB2("");
      setWinner("");
      onMatchRecorded();

      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record match");
    } finally {
      setLoading(false);
    }
  };

  const selectedPlayers = [teamA1, teamA2, teamB1, teamB2].filter(Boolean);

  return (
    <div className="card">
      <h2>Record Match</h2>
      <form onSubmit={handleSubmit}>
        <h3>Team A</h3>
        <PlayerDropdown
          label="Player 1"
          players={sortedPlayers}
          value={teamA1}
          onChange={setTeamA1}
          disabled={loading}
          excludeIds={selectedPlayers.filter((p) => p !== teamA1)}
          seasonEloMap={seasonEloMap}
        />
        <PlayerDropdown
          label="Player 2"
          players={sortedPlayers}
          value={teamA2}
          onChange={setTeamA2}
          disabled={loading}
          excludeIds={selectedPlayers.filter((p) => p !== teamA2)}
          seasonEloMap={seasonEloMap}
        />

        <h3>Team B</h3>
        <PlayerDropdown
          label="Player 1"
          players={sortedPlayers}
          value={teamB1}
          onChange={setTeamB1}
          disabled={loading}
          excludeIds={selectedPlayers.filter((p) => p !== teamB1)}
          seasonEloMap={seasonEloMap}
        />
        <PlayerDropdown
          label="Player 2"
          players={sortedPlayers}
          value={teamB2}
          onChange={setTeamB2}
          disabled={loading}
          excludeIds={selectedPlayers.filter((p) => p !== teamB2)}
          seasonEloMap={seasonEloMap}
        />

        <div className="form-group">
          <label>Winner</label>
          <select
            value={winner}
            onChange={(e) => setWinner(e.target.value as "A" | "B" | "")}
            disabled={loading}
          >
            <option value="" disabled>Select Team</option>
            <option value="A">Team A</option>
            <option value="B">Team B</option>
          </select>
        </div>

        {error && <div className="error-message">{error}</div>}
        {success && (
          <div className="success-message">Match recorded successfully!</div>
        )}

        <button type="submit" disabled={loading}>
          {loading ? "Recording..." : "Record Match"}
        </button>
      </form>
    </div>
  );
}
