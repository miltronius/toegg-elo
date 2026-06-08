import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { recordMatch, Player, PlayerSeasonStats } from "../lib/supabase";
import { PlayerDropdown } from "./PlayerModal";

interface MatchFormProps {
  players: Player[];
  onMatchRecorded: () => void;
  playerSeasonStats?: PlayerSeasonStats[];
}

export function MatchForm({ players, onMatchRecorded, playerSeasonStats = [] }: MatchFormProps) {
  const { t } = useTranslation();
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
      setError(t("matchForm.selectAll"));
      return;
    }

    if (teamA1 === teamA2 || teamB1 === teamB2) {
      setError(t("matchForm.playersDifferent"));
      return;
    }

    if (
      [teamA1, teamA2, teamB1, teamB2].some(
        (p) =>
          [teamA1, teamA2, teamB1, teamB2].filter((x) => x === p).length > 1,
      )
    ) {
      setError(t("matchForm.onePerTeam"));
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
      setError(err instanceof Error ? err.message : t("matchForm.recordError"));
    } finally {
      setLoading(false);
    }
  };

  const selectedPlayers = [teamA1, teamA2, teamB1, teamB2].filter(Boolean);

  return (
    <div className="card">
      <h2>{t("matchForm.title")}</h2>
      <form onSubmit={handleSubmit}>
        <h3>{t("matchForm.teamA")}</h3>
        <PlayerDropdown
          label={t("matchForm.player1")}
          players={sortedPlayers}
          value={teamA1}
          onChange={setTeamA1}
          disabled={loading}
          excludeIds={selectedPlayers.filter((p) => p !== teamA1)}
          seasonEloMap={seasonEloMap}
        />
        <PlayerDropdown
          label={t("matchForm.player2")}
          players={sortedPlayers}
          value={teamA2}
          onChange={setTeamA2}
          disabled={loading}
          excludeIds={selectedPlayers.filter((p) => p !== teamA2)}
          seasonEloMap={seasonEloMap}
        />

        <h3>{t("matchForm.teamB")}</h3>
        <PlayerDropdown
          label={t("matchForm.player1")}
          players={sortedPlayers}
          value={teamB1}
          onChange={setTeamB1}
          disabled={loading}
          excludeIds={selectedPlayers.filter((p) => p !== teamB1)}
          seasonEloMap={seasonEloMap}
        />
        <PlayerDropdown
          label={t("matchForm.player2")}
          players={sortedPlayers}
          value={teamB2}
          onChange={setTeamB2}
          disabled={loading}
          excludeIds={selectedPlayers.filter((p) => p !== teamB2)}
          seasonEloMap={seasonEloMap}
        />

        <div className="form-group">
          <label>{t("matchForm.winner")}</label>
          <select
            value={winner}
            onChange={(e) => setWinner(e.target.value as "A" | "B" | "")}
            disabled={loading}
          >
            <option value="" disabled>{t("matchForm.selectTeam")}</option>
            <option value="A">{t("matchForm.teamA")}</option>
            <option value="B">{t("matchForm.teamB")}</option>
          </select>
        </div>

        {error && (
          <div className="bg-error-light text-error px-4 py-3 rounded-md text-sm border-l-4 border-error mb-3">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-success-light text-success px-4 py-3 rounded-md text-sm border-l-4 border-success mb-3">
            {t("matchForm.recorded")}
          </div>
        )}

        <button type="submit" className="btn-primary w-full mt-2" disabled={loading}>
          {loading ? t("matchForm.recording") : t("matchForm.title")}
        </button>
      </form>
    </div>
  );
}
