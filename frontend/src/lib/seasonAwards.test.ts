import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import de from "../locales/de.json";
import {
  AWARD_ERROR_CODES,
  AWARD_VOTING_LEAD_DAYS,
  AWARD_VOTING_TAIL_DAYS,
  SEASON_AWARDS,
  awardErrorKey,
  awardVotingStatus,
  awardVotingWindow,
  ballotAccess,
  eligibleNomineeIds,
  nextSeasonOf,
  parseSeasonDate,
  picksForSeason,
  seasonsOpenForVoting,
  turnoutRatio,
  awardStandings,
  type AwardResult,
  votingStatusLabel,
  type AwardId,
  type AwardSeason,
  type AwardVote,
} from "./seasonAwards";

const DAY = 86_400_000;
const T0 = Date.parse("2026-10-01T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

function season(over: Partial<AwardSeason> = {}): AwardSeason {
  return {
    number: 5,
    started_at: iso(T0 - 60 * DAY),
    ended_at: null,
    planned_end_at: null,
    voting_opened_at: null,
    voting_closes_at: null,
    ...over,
  };
}
const next = (startedMs: number) => ({ started_at: iso(startedMs) });
const award = (id: AwardId) => SEASON_AWARDS.find((a) => a.id === id)!;

describe("constants", () => {
  it("mirror the SQL window (168 and 336 hours)", () => {
    expect(AWARD_VOTING_LEAD_DAYS).toBe(7);
    expect(AWARD_VOTING_TAIL_DAYS).toBe(14);
  });

  it("list the six awards in ballot order, as the award_id CHECK does", () => {
    expect(SEASON_AWARDS.map((a) => a.id)).toEqual([
      "award_offense",
      "award_defense",
      "award_fun",
      "award_community",
      "award_improved",
      "award_rookie",
    ]);
  });

  it("name every award and explain every error in English and German", () => {
    for (const locale of [en, de]) {
      for (const a of SEASON_AWARDS) {
        expect(locale.seasonAwards.awards[a.id]).toBeTruthy();
      }
      for (const code of AWARD_ERROR_CODES) {
        expect(locale.seasonAwards.errors[code]).toBeTruthy();
      }
    }
  });
});

describe("awardVotingWindow", () => {
  it("has no opening while nothing is set, and no close without a next season", () => {
    expect(awardVotingWindow(season(), null)).toEqual({ opensAt: null, closesAt: null });
  });

  it("opens a lead week before the planned end", () => {
    expect(awardVotingWindow(season({ planned_end_at: iso(T0) }), null).opensAt).toBe(
      T0 - 7 * DAY,
    );
  });

  it("opens at the earliest of the three triggers", () => {
    const s = season({
      voting_opened_at: iso(T0 - 20 * DAY),
      planned_end_at: iso(T0),
      ended_at: iso(T0 - DAY),
    });
    expect(awardVotingWindow(s, null).opensAt).toBe(T0 - 20 * DAY);
    expect(awardVotingWindow({ ...s, voting_opened_at: null }, null).opensAt).toBe(
      T0 - 7 * DAY,
    );
    expect(
      awardVotingWindow({ ...s, voting_opened_at: null, ended_at: iso(T0 - 10 * DAY) }, null)
        .opensAt,
    ).toBe(T0 - 10 * DAY);
  });

  it("closes two weeks into the next season", () => {
    expect(awardVotingWindow(season({ ended_at: iso(T0) }), next(T0)).closesAt).toBe(
      T0 + 14 * DAY,
    );
  });

  it("closes at the admin's closing date instead, earlier or later", () => {
    const s = season({ ended_at: iso(T0) });
    expect(
      awardVotingWindow({ ...s, voting_closes_at: iso(T0 + 3 * DAY) }, next(T0)).closesAt,
    ).toBe(T0 + 3 * DAY);
    expect(
      awardVotingWindow({ ...s, voting_closes_at: iso(T0 + 30 * DAY) }, next(T0)).closesAt,
    ).toBe(T0 + 30 * DAY);
  });

  it("can close a running season's vote before there is a next season", () => {
    expect(awardVotingWindow(season({ voting_closes_at: iso(T0) }), null).closesAt).toBe(T0);
  });

  it("ignores an unparseable timestamp", () => {
    expect(awardVotingWindow(season({ planned_end_at: "soon" }), null).opensAt).toBeNull();
  });
});

describe("awardVotingStatus", () => {
  const planned = season({ planned_end_at: iso(T0) });

  it("is not_open while nothing opens it", () => {
    expect(awardVotingStatus(season(), null, T0)).toBe("not_open");
  });

  it("opens exactly lead days before the planned end", () => {
    expect(awardVotingStatus(planned, null, T0 - 7 * DAY - 1)).toBe("not_open");
    expect(awardVotingStatus(planned, null, T0 - 7 * DAY)).toBe("open");
  });

  it("opens the moment an admin opens it", () => {
    const s = season({ voting_opened_at: iso(T0) });
    expect(awardVotingStatus(s, null, T0 - 1)).toBe("not_open");
    expect(awardVotingStatus(s, null, T0)).toBe("open");
  });

  it("opens when the season ends, even with no planned end", () => {
    const s = season({ ended_at: iso(T0) });
    expect(awardVotingStatus(s, next(T0), T0 - 1)).toBe("not_open");
    expect(awardVotingStatus(s, next(T0), T0)).toBe("open");
  });

  it("stays open while the season runs past its planned end", () => {
    expect(awardVotingStatus(planned, null, T0 + 30 * DAY)).toBe("open");
  });

  it("closes exactly tail days into the next season", () => {
    const s = season({ ended_at: iso(T0) });
    expect(awardVotingStatus(s, next(T0), T0 + 14 * DAY - 1)).toBe("open");
    expect(awardVotingStatus(s, next(T0), T0 + 14 * DAY)).toBe("closed");
  });

  it("closes exactly at the admin's closing date", () => {
    const s = season({ voting_opened_at: iso(T0 - DAY), voting_closes_at: iso(T0) });
    expect(awardVotingStatus(s, null, T0 - 1)).toBe("open");
    expect(awardVotingStatus(s, null, T0)).toBe("closed");
  });

  it("reports finalized once #122 has tallied it, whatever the clock", () => {
    const s = { ...season({ ended_at: iso(T0) }), awards_finalized_at: iso(T0 + 15 * DAY) };
    expect(awardVotingStatus(s, next(T0), T0)).toBe("finalized");
  });
});

describe("seasonsOpenForVoting", () => {
  // S4 ended at T0, when S5 started: S4's ballot runs until T0 + 14 days.
  const s4 = { ...season({ number: 4, ended_at: iso(T0) }), id: "s4" };
  const s5 = { ...season({ number: 5, started_at: iso(T0) }), id: "s5" };

  it("finds the next season by number", () => {
    expect(nextSeasonOf(s4, [s5, s4])).toBe(s5);
    expect(nextSeasonOf(s5, [s5, s4])).toBeNull();
  });

  it("lists the seasons whose ballot is open right now", () => {
    expect(seasonsOpenForVoting([s5, s4], T0 + DAY).map((s) => s.id)).toEqual(["s4"]);
    expect(seasonsOpenForVoting([s5, s4], T0 + 14 * DAY)).toEqual([]);
  });

  it("lists overlapping ballots oldest first", () => {
    const early = { ...s5, voting_opened_at: iso(T0 + DAY) };
    expect(seasonsOpenForVoting([early, s4], T0 + 2 * DAY).map((s) => s.id)).toEqual([
      "s4",
      "s5",
    ]);
  });
});

describe("eligibleNomineeIds", () => {
  const seasons = [
    { id: "s3", number: 3 },
    { id: "s4", number: 4 },
    { id: "s5", number: 5 },
  ];
  const s4 = seasons[1];
  const row = (player_id: string, season_id: string, games: number) => ({
    player_id,
    season_id,
    wins: games,
    losses: 0,
  });
  const stats = [
    row("ranked", "s4", 3),
    row("veteran", "s4", 5),
    row("veteran", "s3", 3),
    row("almost", "s4", 4),
    row("almost", "s3", 2), // played before but was never ranked: still a rookie
    row("later", "s4", 3),
    row("later", "s5", 9), // a later season doesn't count against a rookie
    row("guest", "s4", 2), // played, but too little to be ranked
    row("idle", "s4", 0),
    row("elsewhere", "s3", 7), // no row in s4 at all
  ];
  const ids = (id: AwardId) => [...eligibleNomineeIds(award(id), s4, seasons, stats)].sort();

  it("takes players with RANKED_MIN_GAMES games in the season for ranked awards", () => {
    expect(ids("award_offense")).toEqual(["almost", "later", "ranked", "veteran"]);
  });

  it("counts losses as games too", () => {
    const only = [{ player_id: "x", season_id: "s4", wins: 0, losses: 3 }];
    expect([...eligibleNomineeIds(award("award_fun"), s4, seasons, only)]).toEqual(["x"]);
  });

  it("takes rookies ranked now and never ranked before", () => {
    expect(ids("award_rookie")).toEqual(["almost", "later", "ranked"]);
  });
});

describe("ballotAccess", () => {
  it("lets a linked user or admin vote", () => {
    expect(ballotAccess({ role: "user", myPlayerId: "p1" })).toBe("vote");
    expect(ballotAccess({ role: "admin", myPlayerId: "p1" })).toBe("vote");
  });

  it("asks an unlinked user or admin to link first", () => {
    expect(ballotAccess({ role: "user", myPlayerId: null })).toBe("link");
    expect(ballotAccess({ role: "admin", myPlayerId: null })).toBe("link");
  });

  it("offers viewers and visitors nothing, even a linked viewer", () => {
    expect(ballotAccess({ role: null, myPlayerId: null })).toBe("none");
    expect(ballotAccess({ role: "viewer", myPlayerId: null })).toBe("none");
    expect(ballotAccess({ role: "viewer", myPlayerId: "p1" })).toBe("none");
  });
});

describe("picksForSeason", () => {
  it("maps one season's votes by award", () => {
    const vote = (season_id: string, award_id: AwardId, nominee_player_id: string): AwardVote => ({
      season_id,
      award_id,
      nominee_player_id,
      voter_user_id: "u1",
      updated_at: iso(T0),
    });
    expect(
      picksForSeason(
        [vote("s5", "award_fun", "p2"), vote("s4", "award_fun", "p9"), vote("s5", "award_rookie", "p3")],
        "s5",
      ),
    ).toEqual({ award_fun: "p2", award_rookie: "p3" });
  });
});

describe("parseSeasonDate", () => {
  // Local time, like the field.
  const start = new Date(2026, 9, 1, 12, 0).getTime();

  it("passes empty and invalid text through", () => {
    expect(parseSeasonDate("", start)).toEqual({ kind: "empty" });
    expect(parseSeasonDate("31.02.2026", start)).toEqual({ kind: "invalid" });
  });

  it("refuses an end at or before the start", () => {
    expect(parseSeasonDate("01.10.2026 12:00", start)).toEqual({ kind: "before_start" });
    expect(parseSeasonDate("30.09.2026", start)).toEqual({ kind: "before_start" });
  });

  it("accepts a later moment", () => {
    expect(parseSeasonDate("01.10.2026 12:01", start)).toEqual({
      kind: "ok",
      iso: new Date(2026, 9, 1, 12, 1).toISOString(),
    });
  });
});

describe("awardErrorKey", () => {
  it("maps the RPC codes to translation keys and nothing else", () => {
    expect(awardErrorKey({ message: "self_vote" })).toBe("seasonAwards.errors.self_vote");
    expect(awardErrorKey(new Error("Failed to fetch"))).toBeNull();
    expect(awardErrorKey("self_vote")).toBeNull();
  });
});

describe("turnoutRatio", () => {
  it("reads voters of eligible", () => {
    expect(turnoutRatio({ voters: 3, eligible: 8, awards: {} })).toEqual({ voters: 3, eligible: 8 });
  });

  it("never shows more voters than eligible accounts", () => {
    expect(turnoutRatio({ voters: 5, eligible: 4, awards: {} })).toEqual({ voters: 5, eligible: 5 });
  });
});

describe("votingStatusLabel", () => {
  it("says when a not-yet-open vote opens", () => {
    expect(votingStatusLabel(season({ planned_end_at: iso(T0) }), null, T0 - 30 * DAY)).toEqual({
      key: "votingOpens",
      at: T0 - 7 * DAY,
    });
    expect(votingStatusLabel(season(), null, T0)).toEqual({ key: "votingOpensAtEnd" });
  });

  it("says until when an open vote runs", () => {
    const open = season({ voting_opened_at: iso(T0 - DAY) });
    expect(votingStatusLabel(open, null, T0)).toEqual({ key: "votingOpenUntilNext" });
    expect(votingStatusLabel({ ...open, voting_closes_at: iso(T0 + DAY) }, null, T0)).toEqual({
      key: "votingOpenUntil",
      at: T0 + DAY,
    });
  });

  it("says when a vote closed, and when results are final", () => {
    const closed = season({ voting_opened_at: iso(T0 - 2 * DAY), voting_closes_at: iso(T0 - DAY) });
    expect(votingStatusLabel(closed, null, T0)).toEqual({ key: "votingClosed", at: T0 - DAY });
    expect(votingStatusLabel({ ...closed, awards_finalized_at: iso(T0) }, null, T0)).toEqual({
      key: "votingFinalized",
    });
  });
});

describe("awardStandings", () => {
  const r = (award_id: AwardId, player_id: string, votes: number, is_winner = false, season_id = "s4"): AwardResult => ({
    season_id,
    award_id,
    player_id,
    votes,
    is_winner,
  });

  it("lists every award in ballot order, nominees by votes", () => {
    const got = awardStandings(
      [r("award_fun", "p2", 1), r("award_fun", "p1", 3, true), r("award_offense", "p9", 5, true, "s5")],
      "s4",
    );
    expect(got.map((s) => s.award.id)).toEqual(SEASON_AWARDS.map((a) => a.id));
    const fun = got.find((s) => s.award.id === "award_fun")!;
    expect(fun.nominees).toEqual([
      { playerId: "p1", votes: 3, isWinner: true },
      { playerId: "p2", votes: 1, isWinner: false },
    ]);
    expect(fun.totalVotes).toBe(4);
    expect(fun.awarded).toBe(true);
  });

  it("awards a single vote, and leaves only an award nobody voted in unawarded", () => {
    const got = awardStandings([r("award_rookie", "p1", 1, true)], "s4");
    expect(got.find((s) => s.award.id === "award_rookie")).toMatchObject({
      awarded: true,
      totalVotes: 1,
    });
    expect(got.find((s) => s.award.id === "award_offense")).toMatchObject({
      nominees: [],
      totalVotes: 0,
      awarded: false,
    });
  });

  it("keeps a shared win shared", () => {
    const got = awardStandings([r("award_fun", "p2", 2, true), r("award_fun", "p1", 2, true)], "s4");
    expect(got.find((s) => s.award.id === "award_fun")!.nominees.map((n) => n.playerId)).toEqual(["p1", "p2"]);
  });
});
