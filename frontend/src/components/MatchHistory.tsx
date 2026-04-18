import { useState } from "react";
import clsx from "clsx";
import { Match, Player, EloHistory, Season, PlayerSeasonStats } from "../lib/supabase";

interface MatchHistoryProps {
  matches: Match[];
  players: Player[];
  eloHistory: Map<string, EloHistory[]>;
  seasons?: Season[];
  playerSeasonStats?: PlayerSeasonStats[];
  isAdmin?: boolean;
  onDeleteMatch?: (matchId: string) => Promise<void>;
}

export function MatchHistory({
  matches,
  players,
  eloHistory,
  seasons = [],
  playerSeasonStats = [],
  isAdmin = false,
  onDeleteMatch,
}: MatchHistoryProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const seasonMap = new Map(seasons.map((s) => [s.id, s]));

  const seasonStatsMap = new Map(
    playerSeasonStats.map((s) => [`${s.player_id}-${s.season_id}`, s.elo_at_start]),
  );
  const getSeasonStartAlltimeElo = (playerId: string, seasonId: string): number | null =>
    seasonStatsMap.get(`${playerId}-${seasonId}`) ?? null;

  return (
    <div className="card">
      <h2>Match History</h2>
      {matches.length === 0 ? (
        <p className="text-center py-12 px-4 text-text-light text-[0.95rem]">
          No matches recorded yet. Record a match to get started!
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {matches.map((match, index) => {
            const teamA1 = playerMap.get(match.team_a_player_1_id);
            const teamA2 = playerMap.get(match.team_a_player_2_id);
            const teamB1 = playerMap.get(match.team_b_player_1_id);
            const teamB2 = playerMap.get(match.team_b_player_2_id);

            const teamAWon = match.winning_team === "A";

            const getEloChange = (playerId: string) => {
              const playerHistory = eloHistory.get(playerId) || [];
              return playerHistory.find((h) => h.match_id === match.id);
            };

            const renderPlayerEloDetails = (
              playerId: string,
              playerName: string | undefined,
            ) => {
              const history = getEloChange(playerId);
              if (!history) return null;

              const seasonStartAlltime = match.season_id
                ? getSeasonStartAlltimeElo(playerId, match.season_id)
                : null;

              const eloBefore = seasonStartAlltime !== null
                ? 1500 + (history.elo_before - seasonStartAlltime)
                : history.elo_before;
              const eloAfter = seasonStartAlltime !== null
                ? 1500 + (history.elo_after - seasonStartAlltime)
                : history.elo_after;

              const change = eloAfter - eloBefore;
              const changePercent = ((change / eloBefore) * 100).toFixed(1);

              return (
                <div className="flex items-center gap-3 text-[0.9rem] px-2 py-1.5 rounded bg-white/40">
                  <span className="font-medium min-w-25">{playerName}</span>
                  <span className="text-text-light text-[0.85rem]">{eloBefore}</span>
                  <span className="text-text-light font-light">→</span>
                  <span className={clsx("font-semibold min-w-11.25", change > 0 ? "text-success" : "text-error")}>
                    {eloAfter}
                  </span>
                  <span className={clsx("text-[0.8rem] px-2 py-1 rounded font-medium", change > 0 ? "text-success bg-success/10" : "text-error bg-error/10")}>
                    {change > 0 ? "+" : ""}{change} ({changePercent}%)
                  </span>
                </div>
              );
            };

            const season = match.season_id ? seasonMap.get(match.season_id) : undefined;

            return (
              <div key={match.id} className="bg-bg border border-border rounded-lg p-6 transition-all hover:shadow-md">
                <div className="flex items-center gap-6 mb-4 max-sm:flex-col max-sm:gap-4">
                  <div className={clsx("flex-1 p-4 rounded-md border-2", teamAWon ? "bg-success-light border-success" : "bg-error-light border-error opacity-70")}>
                    <div className="font-semibold mb-3 text-text">Team A {teamAWon && "✓"}</div>
                    <div className="flex flex-col gap-2">
                      {renderPlayerEloDetails(match.team_a_player_1_id, teamA1?.name)}
                      {renderPlayerEloDetails(match.team_a_player_2_id, teamA2?.name)}
                    </div>
                  </div>

                  <div className="flex items-center justify-center w-15 font-semibold text-text-light shrink-0 max-sm:w-full">
                    vs
                  </div>

                  <div className={clsx("flex-1 p-4 rounded-md border-2", !teamAWon ? "bg-success-light border-success" : "bg-error-light border-error opacity-70")}>
                    <div className="font-semibold mb-3 text-text">Team B {!teamAWon && "✓"}</div>
                    <div className="flex flex-col gap-2">
                      {renderPlayerEloDetails(match.team_b_player_1_id, teamB1?.name)}
                      {renderPlayerEloDetails(match.team_b_player_2_id, teamB2?.name)}
                    </div>
                  </div>
                </div>
                <div className="flex justify-between items-center mt-4 pt-4 border-t border-border-light">
                  <div className="text-[0.85rem] text-text-light text-right">
                    {new Date(match.created_at).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                  {season && (
                    <div className="match-season-badge">
                      S{season.number}
                    </div>
                  )}
                  {isAdmin && onDeleteMatch && index === 0 && (
                    <button
                      className="btn-danger btn-small"
                      disabled={deletingId === match.id}
                      onClick={async () => {
                        if (!confirm("Delete this match? ELO changes will be reversed.")) return;
                        setDeletingId(match.id);
                        try {
                          await onDeleteMatch(match.id);
                        } finally {
                          setDeletingId(null);
                        }
                      }}
                    >
                      {deletingId === match.id ? "Deleting…" : "Delete"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
