import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Player, Season } from "../lib/supabase";
import {
  awardStandings,
  awardVotingStatus,
  nextSeasonOf,
  type AwardResult,
} from "../lib/seasonAwards";

interface SeasonAwardResultsProps {
  season: Season;
  seasons: Season[];
  results: AwardResult[];
  /** From get_players(): real names for users/admins, anonymous ones otherwise. */
  players: Pick<Player, "id" | "name">[];
}

/**
 * Season Stats' "Season Awards" section for one season. Counted: every award
 * with the winners highlighted and the full ranking by votes ("No votes" for
 * an award nobody voted in). Closed but not counted: a note
 * that the results follow once an admin counts. Before that it shows nothing -
 * an open ballot has the vote nudge at the top of the dialog instead.
 */
export function SeasonAwardResults({ season, seasons, results, players }: SeasonAwardResultsProps) {
  const { t } = useTranslation();
  // A snapshot is enough: the dialog is short-lived, and counting refetches.
  const [now] = useState(() => Date.now());
  const status = awardVotingStatus(season, nextSeasonOf(season, seasons), now);
  const standings = useMemo(() => awardStandings(results, season.id), [results, season.id]);
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? "?";

  if (status !== "finalized" && status !== "closed") return null;

  return (
    <section className="award-results" aria-labelledby={`award-results-${season.id}`}>
      <div id={`award-results-${season.id}`} className="season-stats-subhead">
        🏆 {t("seasonAwards.results.title")}
      </div>
      {status === "closed" ? (
        <p className="award-results-pending">{t("seasonAwards.results.pending")}</p>
      ) : (
        <div className="award-results-grid">
          {standings.map(({ award, nominees, awarded }) => (
            <div key={award.id} className={`award-result${awarded ? " is-awarded" : ""}`}>
              <div className="award-result-head">
                <span aria-hidden="true">{award.icon}</span>{" "}
                {t(`seasonAwards.awards.${award.id}`)}
              </div>
              {awarded ? (
                <div className="award-result-winners">
                  {nominees
                    .filter((n) => n.isWinner)
                    .map((n) => nameOf(n.playerId))
                    .join(" & ")}
                </div>
              ) : (
                <div className="award-result-none">{t("seasonAwards.results.noVotes")}</div>
              )}
              {nominees.length > 0 && (
                <ol className="award-result-ranking">
                  {nominees.map((n) => (
                    <li key={n.playerId} className={n.isWinner ? "is-winner" : undefined}>
                      <span>{nameOf(n.playerId)}</span>
                      <span className="award-result-votes">
                        {t("seasonAwards.results.votes", { count: n.votes })}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
