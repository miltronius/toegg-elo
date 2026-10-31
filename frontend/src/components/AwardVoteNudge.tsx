import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PlayerSeasonStats, Season } from "../lib/supabase";
import { useMe } from "../contexts/AuthContext";
import { useTilt } from "../hooks/useTilt";
import { DATE_LOCALE } from "../lib/i18n";
import {
  AWARD_VOTING_TAIL_DAYS,
  awardVotingWindow,
  ballotAccess,
  nextSeasonOf,
  picksForSeason,
  seasonsOpenForVoting,
  turnoutRatio,
  votableAwardIds,
  type AwardTurnout,
  type AwardVote,
} from "../lib/seasonAwards";

// A window opening changes nothing in the DB, so no event would re-render us.
const TICK_MS = 60_000;
// The bar is as wide as the page, so a few degrees already swing its ends.
const MAX_TILT_DEG = 2;

interface AwardVoteNudgeProps {
  seasons: Season[];
  /** The signed-in voter's own votes, every season. */
  votes: AwardVote[];
  /** Every season's standings: who can be voted for, hence "x/N picked". */
  seasonStats: PlayerSeasonStats[];
  onOpenBallot: (seasonId: string) => void;
  /** Turnout per open season (award_turnout), when loaded. */
  turnout?: Partial<Record<string, AwardTurnout>>;
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
 * nothing. A shiny card, so it isn't lost beside the season band: the rainbow
 * rim spins until every award you can vote in is picked, then turns green.
 */
export function AwardVoteNudge({
  seasons,
  votes,
  seasonStats,
  onOpenBallot,
  turnout,
  now,
}: AwardVoteNudgeProps) {
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
        const picks = picksForSeason(votes, season.id);
        const picked = Object.keys(picks).length;
        const total = votableAwardIds(season, seasons, seasonStats, me.myPlayerId, picks).size;
        const { closesAt } = awardVotingWindow(season, nextSeasonOf(season, seasons));
        const closes =
          closesAt === null
            ? t("seasonAwards.nudge.closesAfterSeason", { days: AWARD_VOTING_TAIL_DAYS })
            : t("seasonAwards.nudge.closes", { date: formatDate(closesAt) });
        const seasonTurnout = turnout?.[season.id];
        return (
          <ShinyNudge
            key={season.id}
            done={picked >= total}
            onClick={() => onOpenBallot(season.id)}
          >
            <span className="award-nudge-title">
              {t("seasonAwards.nudge.title")} · {label}
            </span>
            <span className="award-nudge-meta">
              {t("seasonAwards.nudge.picked", { picked, total })} · {closes}
              {seasonTurnout &&
                ` · ${t("seasonAwards.nudge.turnout", turnoutRatio(seasonTurnout))}`}
            </span>
          </ShinyNudge>
        );
      })}
    </div>
  );
}

/** One open ballot's button: its own component, since useTilt is a hook. */
function ShinyNudge({
  done,
  onClick,
  children,
}: {
  done: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const tilt = useTilt<HTMLButtonElement>(MAX_TILT_DEG);
  return (
    <button
      type="button"
      className={`shiny-card award-nudge ${done ? "is-done" : "is-glowing"}`}
      onClick={onClick}
      {...tilt}
    >
      <span className="award-nudge-icon" aria-hidden="true">
        🗳️
      </span>
      <span className="award-nudge-text">{children}</span>
    </button>
  );
}
