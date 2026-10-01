import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Season } from "../lib/supabase";
import { useMe } from "../contexts/AuthContext";
import { DATE_LOCALE } from "../lib/i18n";
import {
  AWARD_VOTING_TAIL_DAYS,
  SEASON_AWARDS,
  awardVotingWindow,
  ballotAccess,
  nextSeasonOf,
  seasonsOpenForVoting,
  type AwardVote,
} from "../lib/seasonAwards";

// A window opening changes nothing in the DB, so no event would re-render us.
const TICK_MS = 60_000;

interface AwardVoteNudgeProps {
  seasons: Season[];
  /** The signed-in voter's own votes, every season. */
  votes: AwardVote[];
  onOpenBallot: (seasonId: string) => void;
  /** Fixed clock for tests; live (ticking) when omitted. */
  now?: number;
}

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString(DATE_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

/**
 * "🗳️ Vote for the Season Awards", one per season whose ballot is open. App
 * builds it once and slots it into Timeline and Season Stats. Only for roles
 * that can vote: an unlinked user/admin is told to link, everyone else sees
 * nothing.
 */
export function AwardVoteNudge({ seasons, votes, onOpenBallot, now }: AwardVoteNudgeProps) {
  const { t } = useTranslation();
  const me = useMe();
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (now !== undefined) return;
    const id = setInterval(() => setTick(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [now]);

  const access = ballotAccess(me);
  if (access === "none") return null;
  const open = seasonsOpenForVoting(seasons, now ?? tick);
  if (open.length === 0) return null;

  return (
    <div className="award-nudges">
      {open.map((season) => {
        const label = `S${season.number} · ${season.name}`;
        if (access === "link") {
          return (
            <div key={season.id} className="award-nudge award-nudge--muted">
              <span className="award-nudge-title">🗳️ {t("seasonAwards.nudge.title")}</span>
              <span className="award-nudge-meta">
                {label} · {t("seasonAwards.nudge.linkToVote")}
              </span>
            </div>
          );
        }
        const picked = votes.filter((v) => v.season_id === season.id).length;
        const { closesAt } = awardVotingWindow(season, nextSeasonOf(season, seasons));
        const closes =
          closesAt === null
            ? t("seasonAwards.nudge.closesAfterSeason", { days: AWARD_VOTING_TAIL_DAYS })
            : t("seasonAwards.nudge.closes", { date: formatDate(closesAt) });
        return (
          <button
            key={season.id}
            type="button"
            className="award-nudge"
            onClick={() => onOpenBallot(season.id)}
          >
            <span className="award-nudge-title">🗳️ {t("seasonAwards.nudge.title")}</span>
            <span className="award-nudge-meta">
              {label} ·{" "}
              {t("seasonAwards.nudge.picked", { picked, total: SEASON_AWARDS.length })} ·{" "}
              {closes}
            </span>
          </button>
        );
      })}
    </div>
  );
}
