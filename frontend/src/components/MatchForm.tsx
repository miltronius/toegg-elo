import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { recordMatch, Player, PlayerSeasonStats, TeamNameRow, Match } from "../lib/supabase";
import { PlayerDropdown } from "./PlayerModal";
import { predictMatch, PlayerProjection } from "../lib/eloPrediction";
import { getTeamNameForPlayers, getHeadToHead } from "../lib/teamUtils";

interface MatchFormProps {
  players: Player[];
  onMatchRecorded: () => void;
  playerSeasonStats?: PlayerSeasonStats[];
  teamNames?: TeamNameRow[];
  kFactor?: number;
  matches?: Match[];
}

function ProjectionChip({ projection }: { projection: PlayerProjection }) {
  const { t } = useTranslation();
  const winChange = projection.winElo - projection.currentElo;
  const loseChange = projection.loseElo - projection.currentElo;

  return (
    <div className="flex items-center gap-2 text-[0.75rem] mb-2 max-sm:flex-col max-sm:items-stretch max-sm:gap-1">
      <span className="flex-1 px-2 py-1 rounded bg-success-light text-success font-medium text-center">
        {t("matchForm.ifWin")} {projection.winElo} ({winChange > 0 ? "+" : ""}{winChange})
      </span>
      <span className="flex-1 px-2 py-1 rounded bg-error-light text-error font-medium text-center">
        {t("matchForm.ifLose")} {projection.loseElo} ({loseChange})
      </span>
    </div>
  );
}

export function MatchForm({
  players,
  onMatchRecorded,
  playerSeasonStats = [],
  teamNames = [],
  kFactor = 32,
  matches = [],
}: MatchFormProps) {
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

  const selectedPlayers = [teamA1, teamA2, teamB1, teamB2].filter(Boolean);
  const hasDuplicate = new Set(selectedPlayers).size !== selectedPlayers.length;
  const allSelected = !!(teamA1 && teamA2 && teamB1 && teamB2);

  const eloOf = (id: string) => seasonEloMap.get(id) ?? players.find((p) => p.id === id)?.current_elo ?? 1500;

  const prediction = !allSelected || hasDuplicate ? null : predictMatch(
    [{ id: teamA1, elo: eloOf(teamA1) }, { id: teamA2, elo: eloOf(teamA2) }],
    [{ id: teamB1, elo: eloOf(teamB1) }, { id: teamB2, elo: eloOf(teamB2) }],
    kFactor,
  );

  const teamAName = teamA1 && teamA2 && teamA1 !== teamA2 ? getTeamNameForPlayers(teamA1, teamA2, teamNames) : null;
  const teamBName = teamB1 && teamB2 && teamB1 !== teamB2 ? getTeamNameForPlayers(teamB1, teamB2, teamNames) : null;
  const teamALabel = teamAName ? `${t("matchForm.teamA")} (${teamAName})` : t("matchForm.teamA");
  const teamBLabel = teamBName ? `${t("matchForm.teamB")} (${teamBName})` : t("matchForm.teamB");

  const pctA = prediction ? Math.round(prediction.teamAWinProbability * 100) : 50;
  const pctB = prediction ? 100 - pctA : 50;

  const headToHead = !allSelected || hasDuplicate
    ? null
    : getHeadToHead([teamA1, teamA2], [teamB1, teamB2], matches);

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

    if (hasDuplicate) {
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

  return (
    <div className="card">
      <h2>{t("matchForm.title")}</h2>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-start max-sm:grid-cols-1">
          <div className={clsx(
            "rounded-lg border-2 p-4 transition-colors",
            winner === "A" ? "border-success bg-success-light/30" : "border-border",
          )}>
            <h3 className="mt-0 font-bold">{teamALabel}</h3>
            <PlayerDropdown
              label={t("matchForm.player1")}
              players={sortedPlayers}
              value={teamA1}
              onChange={setTeamA1}
              disabled={loading}
              excludeIds={selectedPlayers.filter((p) => p !== teamA1)}
              seasonEloMap={seasonEloMap}
            />
            {prediction && <ProjectionChip projection={prediction.teamA[0]} />}
            <PlayerDropdown
              label={t("matchForm.player2")}
              players={sortedPlayers}
              value={teamA2}
              onChange={setTeamA2}
              disabled={loading}
              excludeIds={selectedPlayers.filter((p) => p !== teamA2)}
              seasonEloMap={seasonEloMap}
            />
            {prediction && <ProjectionChip projection={prediction.teamA[1]} />}

            <button
              type="button"
              onClick={() => setWinner("A")}
              disabled={loading}
              className={clsx(
                "w-full mt-3 py-2.5 rounded-md font-semibold text-sm border-2 transition-colors",
                winner === "A"
                  ? "bg-success-light border-success text-success"
                  : "bg-bg border-border text-text-light hover:border-primary hover:text-text",
              )}
            >
              {winner === "A" && "✓ "}{teamALabel}
            </button>
          </div>

          <div className="flex flex-col items-center justify-center gap-2 pt-6 max-sm:order-first max-sm:pt-0 max-sm:pb-2">
            <div className="font-semibold text-text-light">{t("matchHistory.vs")}</div>
            {prediction ? (
              <div className="w-30">
                <div className="flex h-2.5 rounded-full overflow-hidden bg-border">
                  <div className="bg-primary" style={{ width: `${pctA}%` }} />
                  <div className="bg-text-light" style={{ width: `${pctB}%` }} />
                </div>
                <div className="flex justify-between text-xs mt-1 font-medium">
                  <span className="text-primary">{pctA}%</span>
                  <span className="text-text-light">{pctB}%</span>
                </div>
                {headToHead && (
                  <div className="text-xs text-text-light text-center mt-3 w-30">
                    {headToHead.totalMatches === 0 ? (
                      t("matchForm.noPriorMatches")
                    ) : (
                      <>
                        <div>{t("matchForm.headToHead")}</div>
                        <div className="font-semibold text-text mt-0.5">
                          {headToHead.teamAWins} – {headToHead.teamBWins}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-text-light text-center w-30">{t("matchForm.previewHint")}</p>
            )}
          </div>

          <div className={clsx(
            "rounded-lg border-2 p-4 transition-colors",
            winner === "B" ? "border-success bg-success-light/30" : "border-border",
          )}>
            <h3 className="mt-0 font-bold">{teamBLabel}</h3>
            <PlayerDropdown
              label={t("matchForm.player1")}
              players={sortedPlayers}
              value={teamB1}
              onChange={setTeamB1}
              disabled={loading}
              excludeIds={selectedPlayers.filter((p) => p !== teamB1)}
              seasonEloMap={seasonEloMap}
            />
            {prediction && <ProjectionChip projection={prediction.teamB[0]} />}
            <PlayerDropdown
              label={t("matchForm.player2")}
              players={sortedPlayers}
              value={teamB2}
              onChange={setTeamB2}
              disabled={loading}
              excludeIds={selectedPlayers.filter((p) => p !== teamB2)}
              seasonEloMap={seasonEloMap}
            />
            {prediction && <ProjectionChip projection={prediction.teamB[1]} />}

            <button
              type="button"
              onClick={() => setWinner("B")}
              disabled={loading}
              className={clsx(
                "w-full mt-3 py-2.5 rounded-md font-semibold text-sm border-2 transition-colors",
                winner === "B"
                  ? "bg-success-light border-success text-success"
                  : "bg-bg border-border text-text-light hover:border-primary hover:text-text",
              )}
            >
              {winner === "B" && "✓ "}{teamBLabel}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-error-light text-error px-4 py-3 rounded-md text-sm border-l-4 border-error mb-3 mt-4">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-success-light text-success px-4 py-3 rounded-md text-sm border-l-4 border-success mb-3 mt-4">
            {t("matchForm.recorded")}
          </div>
        )}

        <button type="submit" className="btn-primary w-full mt-4" disabled={loading}>
          {loading ? t("matchForm.recording") : t("matchForm.title")}
        </button>
      </form>
    </div>
  );
}
