import { assertEquals } from "@std/assert";
import {
  computeGoalAchievements,
  type Match,
  type MatchGame,
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
