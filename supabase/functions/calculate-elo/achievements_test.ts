import { assertEquals } from "@std/assert";
import {
  computeAchievementsForPlayer,
  computeGoalAchievements,
  computeSeasonParticipation,
  computeSeasonPlacements,
  type Match,
  type MatchGame,
  type SeasonRow,
  type SeasonStatRow,
  teamGoals,
} from "../_shared/achievements.ts";

// p1 + p2 (team A) against p3 + p4 (team B) unless a test says otherwise.
function makeMatch(seq: number, overrides: Partial<Match> = {}): Match {
  return {
    id: `m${seq}`,
    team_a_player_1_id: "p1",
    team_a_player_2_id: "p2",
    team_b_player_1_id: "p3",
    team_b_player_2_id: "p4",
    winning_team: "A",
    team_a_games: 1,
    team_b_games: 0,
    games: null,
    season_id: "s1",
    created_at: new Date(Date.UTC(2026, 0, 1, 0, seq)).toISOString(),
    ...overrides,
  };
}

function series(...games: MatchGame[]): Partial<Match> {
  const a = games.filter((g) => g.w === "A").length;
  const b = games.length - a;
  return {
    games,
    team_a_games: a,
    team_b_games: b,
    winning_team: a > b ? "A" : "B",
  };
}

const win = (a: number | null = null, b: number | null = null): MatchGame => ({
  w: "A",
  a,
  b,
});
const loss = (a: number | null = null, b: number | null = null): MatchGame => ({
  w: "B",
  a,
  b,
});

const ids = (m: Match[], player = "p1") =>
  computeGoalAchievements(player, m).map((u) => u.achievementId);

// ---------------------------------------------------------------------------
// teamGoals
// ---------------------------------------------------------------------------

Deno.test("teamGoals: pre-series match counts as 10:0 to the winner", () => {
  const m = makeMatch(1, { winning_team: "B" });
  assertEquals(teamGoals(m, "A"), 0);
  assertEquals(teamGoals(m, "B"), 10);
});

Deno.test("teamGoals: fully scored games count as entered", () => {
  const m = makeMatch(1, series(win(10, 7), loss(4, 10), win(10, 9)));
  assertEquals(teamGoals(m, "A"), 24);
  assertEquals(teamGoals(m, "B"), 26);
});

Deno.test("teamGoals: winner-only games fall back to 10 for the winner, 0 for the loser", () => {
  const m = makeMatch(1, series(win(), loss(), win()));
  assertEquals(teamGoals(m, "A"), 20);
  assertEquals(teamGoals(m, "B"), 10);
});

Deno.test("teamGoals: half-filled games fall back per side", () => {
  // A won with the loser's score left empty; B won with only A's score typed.
  const m = makeMatch(1, series(win(10, null), loss(6, null)));
  assertEquals(teamGoals(m, "A"), 16);
  assertEquals(teamGoals(m, "B"), 10);
});

// ---------------------------------------------------------------------------
// Flawless Victory / Fatality
// ---------------------------------------------------------------------------

Deno.test("flawless_victory / fatality: an explicit 10:0 unlocks both sides", () => {
  const matches = [makeMatch(1, series(win(10, 0)))];
  assertEquals(ids(matches, "p1"), ["flawless_victory"]);
  assertEquals(ids(matches, "p2"), ["flawless_victory"]);
  assertEquals(ids(matches, "p3"), ["fatality"]);
  assertEquals(ids(matches, "p4"), ["fatality"]);
});

Deno.test("flawless_victory: winner-only and half-filled games never count", () => {
  const matches = [
    makeMatch(1),
    makeMatch(2, series(win())),
    makeMatch(3, series(win(10, null))),
    makeMatch(4, series(win(null, 0))),
    makeMatch(5, series(win(10, 1))),
  ];
  assertEquals(ids(matches, "p1"), []);
  assertEquals(ids(matches, "p3"), []);
});

Deno.test("flawless_victory: unlocks on the first qualifying match, once", () => {
  const matches = [
    makeMatch(1, series(win(10, 3))),
    makeMatch(2, series(win(10, 0), win(10, 0))),
    makeMatch(3, series(win(10, 0))),
  ];
  const got = computeGoalAchievements("p1", matches);
  assertEquals(got.length, 1);
  assertEquals(got[0].unlockedAt.toISOString(), matches[1].created_at);
});

Deno.test("flawless_victory: works from team B too", () => {
  const matches = [makeMatch(1, series(loss(0, 10)))];
  assertEquals(ids(matches, "p3"), ["flawless_victory"]);
  assertEquals(ids(matches, "p1"), ["fatality"]);
});

// ---------------------------------------------------------------------------
// Career goal tiers
// ---------------------------------------------------------------------------

Deno.test("goals_200: unlocks on the match that crossed 200", () => {
  // 19 pre-series wins = 190 goals, then a 10:4 game crosses to 200.
  const matches = Array.from({ length: 19 }, (_, i) => makeMatch(i));
  matches.push(makeMatch(19, series(win(10, 4))));
  matches.push(makeMatch(20));
  const got = computeGoalAchievements("p1", matches).filter(
    (u) => u.achievementId === "goals_200",
  );
  assertEquals(got.length, 1);
  assertEquals(got[0].unlockedAt.toISOString(), matches[19].created_at);
});

Deno.test("goals_200: losses still add the goals you scored", () => {
  // 19 wins (190) and a 9:10 loss -> 199, not enough; one more loss 1:10 -> 200.
  const matches = Array.from({ length: 19 }, (_, i) => makeMatch(i));
  matches.push(makeMatch(19, series(loss(9, 10))));
  assertEquals(ids(matches).includes("goals_200"), false);
  matches.push(makeMatch(20, series(loss(1, 10))));
  assertEquals(ids(matches).includes("goals_200"), true);
});

Deno.test("career tiers: one big match can cross several at once", () => {
  const big = Array.from({ length: 101 }, () => win());
  const matches = [makeMatch(1, series(...big))];
  const got = ids(matches);
  assertEquals(got.includes("goals_200"), true);
  assertEquals(got.includes("goals_1000"), true);
  assertEquals(got.includes("goals_10000"), false);
});

// ---------------------------------------------------------------------------
// Pair goal tiers
// ---------------------------------------------------------------------------

Deno.test("pair_goals_100: counts goals with one partner only", () => {
  // 5 wins with p2 and 5 with p4 = 100 career goals, but only 50 per partner.
  const matches = [
    ...Array.from({ length: 5 }, (_, i) => makeMatch(i)),
    ...Array.from({ length: 5 }, (_, i) =>
      makeMatch(10 + i, {
        team_a_player_2_id: "p4",
        team_b_player_2_id: "p2",
      })
    ),
  ];
  assertEquals(ids(matches).includes("pair_goals_100"), false);
});

Deno.test("pair_goals_100: goes to the first partnership to cross, with its partner", () => {
  // p1 alternates between p2 and p4; p4 is the first to reach 100 together.
  const withP2 = (seq: number) => makeMatch(seq);
  const withP4 = (seq: number, overrides: Partial<Match> = {}) =>
    makeMatch(seq, {
      team_a_player_2_id: "p4",
      team_b_player_2_id: "p2",
      ...overrides,
    });
  const matches = [
    withP2(0),
    withP4(1, series(win(), win())), // p4: 20
    ...Array.from({ length: 8 }, (_, i) => withP4(2 + i)), // p4: 100 at seq 9
    ...Array.from({ length: 10 }, (_, i) => withP2(20 + i)), // p2: 110
  ];
  const got = computeGoalAchievements("p1", matches).filter(
    (u) => u.achievementId === "pair_goals_100",
  );
  assertEquals(got.length, 1);
  assertEquals(got[0].meta, { partnerId: "p4" });
  assertEquals(got[0].unlockedAt.toISOString(), matches[9].created_at);
});

Deno.test("pair goals: player position on the team doesn't matter", () => {
  // p1 as team B's second player, partnered with p3.
  const matches = Array.from({ length: 10 }, (_, i) =>
    makeMatch(i, { winning_team: "B" })
  ).map((m) => ({
    ...m,
    team_b_player_2_id: "p1",
    team_a_player_1_id: "p4",
  }));
  const got = computeGoalAchievements("p1", matches).filter(
    (u) => u.achievementId === "pair_goals_100",
  );
  assertEquals(got.length, 1);
  assertEquals(got[0].meta, { partnerId: "p3" });
});

Deno.test("pair tiers sit at 100, 500 and 1,000 goals", () => {
  const games = (n: number) => series(...Array.from({ length: n }, () => win()));
  assertEquals(ids([makeMatch(1, games(99))]).filter((id) => id.startsWith("pair_")), [
    "pair_goals_100",
    "pair_goals_500",
  ]);
  assertEquals(ids([makeMatch(1, games(100))]).filter((id) => id.startsWith("pair_")), [
    "pair_goals_100",
    "pair_goals_500",
    "pair_goals_1000",
  ]);
});

// ---------------------------------------------------------------------------
// That's Me! (linked_account)
// ---------------------------------------------------------------------------

// Nine daily wins for p1, the last one an explicit 10:0: exactly nine
// achievements, so a link is the one that makes ten.
function nineAchievementSeason(): Match[] {
  return Array.from({ length: 9 }, (_, i) =>
    makeMatch(i + 1, {
      // No season, so On the Board doesn't add a tenth achievement.
      season_id: null,
      created_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      ...(i === 8 ? series(win(10, 0)) : {}),
    })
  );
}

const achievementsOf = (matches: Match[], linkedAt: Date | null = null) =>
  computeAchievementsForPlayer(
    "p1",
    { id: "p1" } as Parameters<typeof computeAchievementsForPlayer>[1],
    matches,
    [],
    [],
    linkedAt,
  );

Deno.test("linked_account: unlocked at the link time", () => {
  const linkedAt = new Date("2026-09-20T10:00:00Z");
  const got = achievementsOf([], linkedAt);
  assertEquals(got, [{ achievementId: "linked_account", unlockedAt: linkedAt }]);
});

Deno.test("linked_account: absent without a link", () => {
  assertEquals(
    achievementsOf(nineAchievementSeason()).some(
      (a) => a.achievementId === "linked_account",
    ),
    false,
  );
});

Deno.test("linked_account: counts toward achievement_hunter", () => {
  const matches = nineAchievementSeason();
  const unlinked = achievementsOf(matches);
  assertEquals(unlinked.length, 9);
  assertEquals(unlinked.some((a) => a.achievementId === "achievement_hunter"), false);

  // Linked after the ninth, so the link is the tenth - and dates the meta.
  const linkedAt = new Date("2026-02-01T12:00:00Z");
  const hunter = achievementsOf(matches, linkedAt).find(
    (a) => a.achievementId === "achievement_hunter",
  );
  assertEquals(hunter?.unlockedAt, linkedAt);
});

// ---------------------------------------------------------------------------
// Season achievements
// ---------------------------------------------------------------------------

const ENDED = "2026-08-03T04:00:00.000Z";
const endedSeason = (id = "s1", ended_at: string | null = ENDED): SeasonRow => ({
  id,
  number: 1,
  started_at: "2026-05-30T00:00:00.000Z",
  ended_at,
});

// elos[i] belongs to player `p${i + 1}`; every player is ranked (3 games)
// unless `games` says otherwise.
function standings(
  elos: number[],
  games: number[] = elos.map(() => 3),
  season_id = "s1",
): SeasonStatRow[] {
  return elos.map((elo, i) => ({
    player_id: `p${i + 1}`,
    season_id,
    current_season_elo: elo,
    wins: games[i],
    losses: 0,
  }));
}

const placementIds = (
  seasons: SeasonRow[],
  stats: SeasonStatRow[],
  player: string,
) =>
  (computeSeasonPlacements(seasons, stats).get(player) ?? [])
    .map((u) => u.achievementId)
    .sort();

Deno.test("placements: 1st/2nd/3rd get their medal only, dated ended_at", () => {
  const stats = standings([1700, 1650, 1600, 1550, 1520, 1400]);
  const got = computeSeasonPlacements([endedSeason()], stats);
  assertEquals(got.get("p1"), [
    { achievementId: "season_net_positive", unlockedAt: new Date(ENDED), seasonId: "s1" },
    { achievementId: "season_top_1", unlockedAt: new Date(ENDED), seasonId: "s1" },
  ]);
  assertEquals(placementIds([endedSeason()], stats, "p2"), ["season_net_positive", "season_top_2"]);
  assertEquals(placementIds([endedSeason()], stats, "p3"), ["season_net_positive", "season_top_3"]);
  assertEquals(placementIds([endedSeason()], stats, "p4"), ["season_net_positive", "season_top_5"]);
});

Deno.test("placements: ties share a rank (1, 2, 2, 4)", () => {
  const stats = standings([1700, 1600, 1600, 1550, 1500, 1400]);
  assertEquals(placementIds([endedSeason()], stats, "p2"), ["season_net_positive", "season_top_2"]);
  assertEquals(placementIds([endedSeason()], stats, "p3"), ["season_net_positive", "season_top_2"]);
  assertEquals(placementIds([endedSeason()], stats, "p4"), ["season_net_positive", "season_top_5"]);
});

Deno.test("placements: a shared first place makes two champions", () => {
  const stats = standings([1700, 1700, 1600, 1550, 1500]);
  assertEquals(placementIds([endedSeason()], stats, "p1"), ["season_net_positive", "season_top_1"]);
  assertEquals(placementIds([endedSeason()], stats, "p2"), ["season_net_positive", "season_top_1"]);
  assertEquals(placementIds([endedSeason()], stats, "p3"), ["season_net_positive", "season_top_3"]);
});

Deno.test("placements: none below 5 ranked players, net positive still counts", () => {
  const stats = standings([1700, 1650, 1600, 1400]);
  assertEquals(placementIds([endedSeason()], stats, "p1"), ["season_net_positive"]);
  assertEquals(placementIds([endedSeason()], stats, "p4"), []);
});

Deno.test("placements: Top N needs more than N ranked players", () => {
  // Exactly 5 ranked: medals yes, High Five no (5 is not > 5).
  const five = standings([1700, 1650, 1600, 1450, 1400]);
  assertEquals(placementIds([endedSeason()], five, "p3"), ["season_net_positive", "season_top_3"]);
  assertEquals(placementIds([endedSeason()], five, "p4"), []);
  // 10 ranked: rank 7 gets nothing (Top Ten needs 11).
  const ten = standings([1900, 1850, 1800, 1750, 1700, 1650, 1450, 1400, 1350, 1300]);
  assertEquals(placementIds([endedSeason()], ten, "p7"), []);
  // 11 ranked: rank 7 gets Top Ten.
  const eleven = standings([1900, 1850, 1800, 1750, 1700, 1650, 1450, 1400, 1350, 1300, 1250]);
  assertEquals(placementIds([endedSeason()], eleven, "p7"), ["season_top_10"]);
});

Deno.test("placements: unranked players neither rank nor count toward the floor", () => {
  // p6 has the top rating but only 2 games: not ranked, and the season has
  // just 5 ranked players - p1 is champion.
  const stats = standings([1700, 1650, 1600, 1550, 1520, 1900], [3, 3, 3, 3, 3, 2]);
  assertEquals(placementIds([endedSeason()], stats, "p6"), []);
  assertEquals(placementIds([endedSeason()], stats, "p1"), ["season_net_positive", "season_top_1"]);
});

Deno.test("placements: net positive needs 1501, 1500 is not enough", () => {
  const stats = standings([1501, 1500, 1400, 1400, 1400]);
  assertEquals(placementIds([endedSeason()], stats, "p1").includes("season_net_positive"), true);
  assertEquals(placementIds([endedSeason()], stats, "p2").includes("season_net_positive"), false);
});

Deno.test("placements: the active season awards nothing", () => {
  const stats = standings([1700, 1650, 1600, 1550, 1520]);
  assertEquals(computeSeasonPlacements([endedSeason("s1", null)], stats).size, 0);
});

Deno.test("participation: unlocks at the 3rd match of a season, active or not", () => {
  const ms = [
    makeMatch(1, { season_id: "s1" }),
    makeMatch(2, { season_id: "s1" }),
    makeMatch(3, { season_id: "s2" }),
    makeMatch(4, { season_id: "s1" }),
    makeMatch(5, { season_id: "s2" }),
  ];
  assertEquals(computeSeasonParticipation("p1", ms), [
    { achievementId: "season_participated", unlockedAt: new Date(ms[3].created_at), seasonId: "s1" },
  ]);
});

Deno.test("meta achievements count distinct ids, not rows", () => {
  // Nine distinct achievements, plus the same seasonal one three times: 12
  // rows but 10 distinct ids - achievement_hunter unlocks with the first
  // season_top_1, not with a repeat.
  const matches = nineAchievementSeason();
  const first = new Date("2026-02-01T00:00:00Z");
  const extra = ["s1", "s2", "s3"].map((seasonId, i) => ({
    achievementId: "season_top_1" as const,
    unlockedAt: new Date(first.getTime() + i * 86_400_000),
    seasonId,
  }));
  const got = computeAchievementsForPlayer(
    "p1",
    { id: "p1" } as Parameters<typeof computeAchievementsForPlayer>[1],
    matches,
    [],
    [],
    null,
    extra,
  );
  const hunter = got.find((a) => a.achievementId === "achievement_hunter");
  assertEquals(hunter?.unlockedAt, first);
  // Two repeats don't reach 20 distinct.
  assertEquals(got.some((a) => a.achievementId === "completionist"), false);
});
