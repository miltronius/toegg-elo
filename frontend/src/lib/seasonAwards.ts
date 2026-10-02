/**
 * Season Awards voting (#121): which awards exist, when a season's ballot is
 * open, and who may be nominated. The tally and winners are #122.
 *
 * The server enforces all of this in cast_award_vote
 * (20260930_season_award_voting.sql); everything here mirrors it so the ballot
 * never offers a pick the server would refuse. Change both together.
 *
 * Every decision is a pure function of `(data, now)`: a window opening changes
 * nothing in the database, so no realtime event ever announces it.
 *
 * Pure helpers only - no DB calls, no React.
 */
import { parseSwissDateTime, type ParsedMoment } from "./banners";
import type { Me } from "./playerLinking";
import { RANKED_MIN_GAMES } from "./rosterFilter";
import type { PlayerSeasonStats, Season } from "./supabase";

/** Voting opens this long before a season's planned end (SQL: 168 hours). */
export const AWARD_VOTING_LEAD_DAYS = 7;
/** ...and closes this long after the next season starts (SQL: 336 hours). */
export const AWARD_VOTING_TAIL_DAYS = 14;

const DAY_MS = 86_400_000;

export type AwardId =
  | "award_offense"
  | "award_defense"
  | "award_fun"
  | "award_community"
  | "award_improved"
  | "award_rookie";

/**
 * Who can be nominated:
 * `ranked` - at least RANKED_MIN_GAMES games in the season.
 * `rookie` - ranked in the season, and never ranked in an earlier one.
 */
export type AwardNominees = "ranked" | "rookie";

export type SeasonAward = { id: AwardId; icon: string; nominees: AwardNominees };

/**
 * Fixed in code by design, in ballot order. Names are translated
 * (`seasonAwards.awards.<id>`). The ids are also the CHECK list on
 * season_award_votes.award_id and cast_award_vote's list.
 */
export const SEASON_AWARDS: readonly SeasonAward[] = [
  { id: "award_offense", icon: "⚔️", nominees: "ranked" },
  { id: "award_defense", icon: "🛡️", nominees: "ranked" },
  { id: "award_fun", icon: "🎉", nominees: "ranked" },
  { id: "award_community", icon: "🤝", nominees: "ranked" },
  { id: "award_improved", icon: "🚀", nominees: "ranked" },
  { id: "award_rookie", icon: "🌱", nominees: "rookie" },
];

/** One pick on the caller's ballot, as RLS returns it (own rows only). */
export type AwardVote = {
  season_id: string;
  award_id: AwardId;
  voter_user_id: string;
  nominee_player_id: string;
  updated_at: string;
};

/** The season fields the window reads. `awards_finalized_at` arrives with #122. */
export type AwardSeason = Pick<
  Season,
  "number" | "started_at" | "ended_at" | "planned_end_at" | "voting_opened_at"
> & { awards_finalized_at?: string | null };

export type AwardVotingStatus = "not_open" | "open" | "closed" | "finalized";

/** Unparseable or absent timestamps count as "not set" rather than throwing. */
function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** The season after `season`, which is what closes its ballot. */
export function nextSeasonOf<T extends Pick<Season, "number">>(
  season: Pick<Season, "number">,
  seasons: T[],
): T | null {
  return seasons.find((s) => s.number === season.number + 1) ?? null;
}

/**
 * When a season's ballot opens and closes, in ms. It opens at the earliest of
 * the admin's "Open voting now", a lead week before the planned end, and the
 * actual end (so every season gets a vote); null while none is set. It closes
 * two weeks into the next season; null while there is none yet.
 */
export function awardVotingWindow(
  season: AwardSeason,
  nextSeason: Pick<Season, "started_at"> | null,
): { opensAt: number | null; closesAt: number | null } {
  const plannedEnd = parseTime(season.planned_end_at);
  const triggers = [
    parseTime(season.voting_opened_at),
    plannedEnd === null ? null : plannedEnd - AWARD_VOTING_LEAD_DAYS * DAY_MS,
    parseTime(season.ended_at),
  ].filter((t): t is number => t !== null);
  const nextStart = nextSeason ? parseTime(nextSeason.started_at) : null;
  return {
    opensAt: triggers.length > 0 ? Math.min(...triggers) : null,
    closesAt: nextStart === null ? null : nextStart + AWARD_VOTING_TAIL_DAYS * DAY_MS,
  };
}

/** Half-open like the SQL: open from `opensAt` (inclusive) to `closesAt` (exclusive). */
export function awardVotingStatus(
  season: AwardSeason,
  nextSeason: Pick<Season, "started_at"> | null,
  now: number,
): AwardVotingStatus {
  if (season.awards_finalized_at) return "finalized";
  const { opensAt, closesAt } = awardVotingWindow(season, nextSeason);
  if (closesAt !== null && now >= closesAt) return "closed";
  if (opensAt === null || now < opensAt) return "not_open";
  return "open";
}

/**
 * Seasons whose ballot is open at `now`, oldest first (it closes first).
 * Normally one; two overlap only when a new season's voting is opened within
 * two weeks of its start.
 */
export function seasonsOpenForVoting<T extends AwardSeason & Pick<Season, "id">>(
  seasons: T[],
  now: number,
): T[] {
  return seasons
    .filter((s) => awardVotingStatus(s, nextSeasonOf(s, seasons), now) === "open")
    .sort((a, b) => a.number - b.number);
}

type StatsRow = Pick<PlayerSeasonStats, "player_id" | "season_id" | "wins" | "losses">;

const gamesOf = (row: StatsRow) => row.wins + row.losses;

/**
 * Who may be nominated for `award` in `season`, by player id. Live: during the
 * first voting week the season is still running, so this can change - the
 * server re-checks every vote, and #122 again at the close.
 *
 * Games are series from player_season_stats (wins + losses), the same count
 * the Leaderboard's ranked badge and the season placements use.
 */
export function eligibleNomineeIds(
  award: SeasonAward,
  season: Pick<Season, "id" | "number">,
  seasons: Pick<Season, "id" | "number">[],
  seasonStats: StatsRow[],
): Set<string> {
  const ids = new Set<string>();
  for (const row of seasonStats) {
    if (row.season_id !== season.id) continue;
    if (gamesOf(row) >= RANKED_MIN_GAMES) ids.add(row.player_id);
  }
  if (award.nominees === "rookie") {
    const earlier = new Set(
      seasons.filter((s) => s.number < season.number).map((s) => s.id),
    );
    for (const row of seasonStats) {
      if (earlier.has(row.season_id) && gamesOf(row) >= RANKED_MIN_GAMES) {
        ids.delete(row.player_id);
      }
    }
  }
  return ids;
}

/**
 * `vote` - a linked user/admin. `link` - a user/admin who could vote once they
 * claim their player. `none` - viewers and visitors, who can't claim either
 * (a linked account demoted to viewer included; cast_award_vote refuses it).
 */
export type BallotAccess = "vote" | "link" | "none";

export function ballotAccess(me: Me): BallotAccess {
  if (me.role !== "user" && me.role !== "admin") return "none";
  return me.myPlayerId ? "vote" : "link";
}

/** The caller's picks for one season, by award. */
export function picksForSeason(
  votes: AwardVote[],
  seasonId: string,
): Partial<Record<AwardId, string>> {
  const picks: Partial<Record<AwardId, string>> = {};
  for (const v of votes) {
    if (v.season_id === seasonId) picks[v.award_id] = v.nominee_player_id;
  }
  return picks;
}

/** A planned end must come after the season's start (seasons CHECK). */
export type PlannedEnd = ParsedMoment | { kind: "before_start" };

export function parsePlannedEnd(text: string, startedAtMs: number): PlannedEnd {
  const parsed = parseSwissDateTime(text);
  if (parsed.kind === "ok" && Date.parse(parsed.iso) <= startedAtMs) {
    return { kind: "before_start" };
  }
  return parsed;
}

/** The codes cast_award_vote and open_award_voting raise. */
export const AWARD_ERROR_CODES = [
  "not_allowed",
  "voter_not_linked",
  "unknown_award",
  "voting_not_open",
  "self_vote",
  "nominee_not_eligible",
  "season_not_active",
] as const;

/** Translation key for a voting RPC error, or null for anything unexpected. */
export function awardErrorKey(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return null;
  }
  const message = (error as { message: unknown }).message;
  return (AWARD_ERROR_CODES as readonly unknown[]).includes(message)
    ? `seasonAwards.errors.${message}`
    : null;
}
