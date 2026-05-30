import { describe, it, expect } from "vitest";
import { computeAchievementsForPlayer } from "./achievements";
import type { Match, Player, EloHistory } from "./supabase";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayer(id = "p1"): Player {
  return { id, name: "Test", current_elo: 1500, matches_played: 0, wins: 0, losses: 0, created_at: "", anonymous_name: null };
}

let matchCounter = 0;
function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: `m${++matchCounter}`,
    team_a_player_1_id: "p1",
    team_a_player_2_id: "p2",
    team_b_player_1_id: "p3",
    team_b_player_2_id: "p4",
    winning_team: "A",
    season_id: "s1",
    created_at: "2024-01-15T10:00:00Z", // Monday
    ...overrides,
  };
}

// Returns a UTC ISO string for the given weekday offset from a known Monday (2024-01-15)
// 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
function onDay(offsetFromMonday: number, hour = 10): string {
  const base = new Date("2024-01-15T00:00:00Z"); // Monday
  base.setUTCDate(base.getUTCDate() + offsetFromMonday);
  base.setUTCHours(hour);
  return base.toISOString();
}

// ---------------------------------------------------------------------------
// all_weekdays (Week Warrior)
// ---------------------------------------------------------------------------

describe("all_weekdays achievement", () => {
  it("unlocks when player has played on all 5 workdays", () => {
    const matches = [
      makeMatch({ id: "w1", created_at: onDay(0) }), // Mon
      makeMatch({ id: "w2", created_at: onDay(1) }), // Tue
      makeMatch({ id: "w3", created_at: onDay(2) }), // Wed
      makeMatch({ id: "w4", created_at: onDay(3) }), // Thu
      makeMatch({ id: "w5", created_at: onDay(4) }), // Fri
    ];
    const result = computeAchievementsForPlayer("p1", makePlayer(), matches);
    expect(result.find((a) => a.achievementId === "all_weekdays")).toBeDefined();
  });

  it("does not unlock with only 4 workdays", () => {
    const matches = [
      makeMatch({ id: "d1", created_at: onDay(0) }), // Mon
      makeMatch({ id: "d2", created_at: onDay(1) }), // Tue
      makeMatch({ id: "d3", created_at: onDay(2) }), // Wed
      makeMatch({ id: "d4", created_at: onDay(3) }), // Thu
    ];
    const result = computeAchievementsForPlayer("p1", makePlayer(), matches);
    expect(result.find((a) => a.achievementId === "all_weekdays")).toBeUndefined();
  });

  it("does not unlock with 5 matches all on the same day", () => {
    const matches = [
      makeMatch({ id: "s1", created_at: onDay(0, 9) }),
      makeMatch({ id: "s2", created_at: onDay(0, 10) }),
      makeMatch({ id: "s3", created_at: onDay(0, 11) }),
      makeMatch({ id: "s4", created_at: onDay(0, 12) }),
      makeMatch({ id: "s5", created_at: onDay(0, 13) }),
    ];
    const result = computeAchievementsForPlayer("p1", makePlayer(), matches);
    expect(result.find((a) => a.achievementId === "all_weekdays")).toBeUndefined();
  });

  it("weekend matches do not count toward the 5 workdays", () => {
    const matches = [
      makeMatch({ id: "we1", created_at: onDay(0) }),  // Mon
      makeMatch({ id: "we2", created_at: onDay(1) }),  // Tue
      makeMatch({ id: "we3", created_at: onDay(2) }),  // Wed
      makeMatch({ id: "we4", created_at: onDay(3) }),  // Thu
      makeMatch({ id: "we5", created_at: onDay(5) }),  // Sat — should not count
      makeMatch({ id: "we6", created_at: onDay(6) }),  // Sun — should not count
    ];
    const result = computeAchievementsForPlayer("p1", makePlayer(), matches);
    expect(result.find((a) => a.achievementId === "all_weekdays")).toBeUndefined();
  });

  it("unlocks when 5th workday is reached even if weekends were played too", () => {
    const matches = [
      makeMatch({ id: "mx1", created_at: onDay(0) }),  // Mon
      makeMatch({ id: "mx2", created_at: onDay(1) }),  // Tue
      makeMatch({ id: "mx3", created_at: onDay(5) }),  // Sat (ignored)
      makeMatch({ id: "mx4", created_at: onDay(2) }),  // Wed
      makeMatch({ id: "mx5", created_at: onDay(3) }),  // Thu
      makeMatch({ id: "mx6", created_at: onDay(4) }),  // Fri — completes all 5
    ];
    const result = computeAchievementsForPlayer("p1", makePlayer(), matches);
    const achievement = result.find((a) => a.achievementId === "all_weekdays");
    expect(achievement).toBeDefined();
    // unlockedAt should be the Friday match
    expect(achievement!.unlockedAt.getUTCDay()).toBe(5); // Friday
  });

  it("unlockedAt is the match that completed the 5th unique workday", () => {
    const fridayDate = onDay(4); // Friday
    const matches = [
      makeMatch({ id: "u1", created_at: onDay(0) }),
      makeMatch({ id: "u2", created_at: onDay(1) }),
      makeMatch({ id: "u3", created_at: onDay(2) }),
      makeMatch({ id: "u4", created_at: onDay(3) }),
      makeMatch({ id: "u5", created_at: fridayDate }),
    ];
    const result = computeAchievementsForPlayer("p1", makePlayer(), matches);
    const achievement = result.find((a) => a.achievementId === "all_weekdays");
    expect(achievement?.unlockedAt.toISOString()).toBe(fridayDate);
  });
});

// ---------------------------------------------------------------------------
// Helpers for the new achievement families
// ---------------------------------------------------------------------------

let eloCounter = 0;
function makeElo(overrides: Partial<EloHistory> = {}): EloHistory {
  return {
    id: `e${++eloCounter}`,
    player_id: "p1",
    match_id: null,
    season_id: "s1",
    elo_before: 1500,
    elo_after: 1500,
    elo_change: 0,
    created_at: "2024-01-15T10:00:00Z",
    ...overrides,
  };
}

function makeRoster(ids: string[]): Player[] {
  return ids.map((id) => makePlayer(id));
}

// p1 sits in team A by default, so winning_team "A" is a win for p1.
function p1Win(seq: number): Match {
  return makeMatch({ id: `w${seq}`, winning_team: "A", created_at: onDay(0, seq) });
}
function p1Loss(seq: number): Match {
  return makeMatch({ id: `l${seq}`, winning_team: "B", created_at: onDay(0, seq) });
}

// ---------------------------------------------------------------------------
// Win / loss streaks
// ---------------------------------------------------------------------------

describe("win streak achievements", () => {
  it("unlocks Unstoppable on 3 consecutive wins", () => {
    const r = computeAchievementsForPlayer("p1", makePlayer(), [p1Win(1), p1Win(2), p1Win(3)]);
    expect(r.find((a) => a.achievementId === "streak_win_3")).toBeDefined();
    expect(r.find((a) => a.achievementId === "streak_win_5")).toBeUndefined();
  });

  it("does not unlock when the streak is broken before 3", () => {
    const r = computeAchievementsForPlayer("p1", makePlayer(), [p1Win(1), p1Win(2), p1Loss(3), p1Win(4)]);
    expect(r.find((a) => a.achievementId === "streak_win_3")).toBeUndefined();
  });

  it("unlocks Can't Stop Winning at 5 and dates tier 3 at the 3rd win", () => {
    const r = computeAchievementsForPlayer("p1", makePlayer(), [
      p1Win(1), p1Win(2), p1Win(3), p1Win(4), p1Win(5),
    ]);
    expect(r.find((a) => a.achievementId === "streak_win_5")).toBeDefined();
    const tier3 = r.find((a) => a.achievementId === "streak_win_3");
    expect(tier3!.unlockedAt.toISOString()).toBe(onDay(0, 3));
  });
});

describe("loss streak achievements", () => {
  it("unlocks Rough Patch on 3 consecutive losses", () => {
    const r = computeAchievementsForPlayer("p1", makePlayer(), [p1Loss(1), p1Loss(2), p1Loss(3)]);
    expect(r.find((a) => a.achievementId === "streak_loss_3")).toBeDefined();
  });

  it("does not unlock on a 2-loss streak", () => {
    const r = computeAchievementsForPlayer("p1", makePlayer(), [p1Loss(1), p1Loss(2)]);
    expect(r.find((a) => a.achievementId === "streak_loss_3")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Comeback Kid
// ---------------------------------------------------------------------------

describe("comeback_kid achievement", () => {
  it("unlocks on a win that ends a 3+ loss streak, dated at that win", () => {
    const r = computeAchievementsForPlayer("p1", makePlayer(), [
      p1Loss(1), p1Loss(2), p1Loss(3), p1Win(4),
    ]);
    const c = r.find((a) => a.achievementId === "comeback_kid");
    expect(c).toBeDefined();
    expect(c!.unlockedAt.toISOString()).toBe(onDay(0, 4));
  });

  it("does not unlock after only a 2-loss streak", () => {
    const r = computeAchievementsForPlayer("p1", makePlayer(), [p1Loss(1), p1Loss(2), p1Win(3)]);
    expect(r.find((a) => a.achievementId === "comeback_kid")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Punching Bag (3 consecutive wins vs the same opponent)
// ---------------------------------------------------------------------------

describe("punching_bag achievement", () => {
  it("unlocks on 3 consecutive wins vs the same opponent", () => {
    const r = computeAchievementsForPlayer("p1", makePlayer(), [p1Win(1), p1Win(2), p1Win(3)]);
    const pb = r.find((a) => a.achievementId === "punching_bag");
    expect(pb).toBeDefined();
    expect(pb!.meta?.opponentId).toBe("p3");
  });

  it("resets when a meeting is lost", () => {
    const r = computeAchievementsForPlayer("p1", makePlayer(), [p1Win(1), p1Win(2), p1Loss(3), p1Win(4)]);
    expect(r.find((a) => a.achievementId === "punching_bag")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Teams (distinct partners)
// ---------------------------------------------------------------------------

describe("teams achievements", () => {
  it("unlocks Pairing Up on the first match", () => {
    const r = computeAchievementsForPlayer("p1", makePlayer(), [makeMatch({ id: "t1" })]);
    expect(r.find((a) => a.achievementId === "teams_1")).toBeDefined();
  });

  it("unlocks Team Player with 3 distinct partners", () => {
    const matches = [
      makeMatch({ id: "tA", created_at: onDay(0, 1), team_a_player_2_id: "p2" }),
      makeMatch({ id: "tB", created_at: onDay(0, 2), team_a_player_2_id: "p5" }),
      makeMatch({ id: "tC", created_at: onDay(0, 3), team_a_player_2_id: "p6" }),
    ];
    const r = computeAchievementsForPlayer("p1", makePlayer(), matches);
    expect(r.find((a) => a.achievementId === "teams_3")).toBeDefined();
    expect(r.find((a) => a.achievementId === "teams_10")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// World Tour / Nemesis of All (breadth across the roster)
// ---------------------------------------------------------------------------

describe("world_tour and nemesis_of_all achievements", () => {
  const roster = makeRoster(["p1", "p2", "p3", "p4"]);
  // m1: p1+p2 beat p3+p4 → faces/beats p3,p4
  // m2: p1+p3 beat p2+p4 → faces/beats p2,p4 → all others covered
  const matches = [
    makeMatch({ id: "wt1", created_at: onDay(0, 1) }),
    makeMatch({
      id: "wt2",
      created_at: onDay(0, 2),
      team_a_player_2_id: "p3",
      team_b_player_1_id: "p2",
      team_b_player_2_id: "p4",
    }),
  ];

  it("unlocks World Tour after facing every other player", () => {
    const r = computeAchievementsForPlayer("p1", makePlayer(), matches, roster);
    expect(r.find((a) => a.achievementId === "world_tour")).toBeDefined();
  });

  it("unlocks Nemesis of All after beating every other player", () => {
    const r = computeAchievementsForPlayer("p1", makePlayer(), matches, roster);
    expect(r.find((a) => a.achievementId === "nemesis_of_all")).toBeDefined();
  });

  it("does not unlock without a roster of at least 4", () => {
    const r = computeAchievementsForPlayer("p1", makePlayer(), matches);
    expect(r.find((a) => a.achievementId === "world_tour")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ELO day-swings (To The Moon / Rock Bottom)
// ---------------------------------------------------------------------------

describe("to_the_moon and rock_bottom achievements", () => {
  it("unlocks To The Moon when a single day nets +100", () => {
    const elo = [
      makeElo({ elo_change: 60, created_at: onDay(0, 1) }),
      makeElo({ elo_change: 50, created_at: onDay(0, 2) }),
    ];
    const r = computeAchievementsForPlayer("p1", makePlayer(), [], [], elo);
    expect(r.find((a) => a.achievementId === "to_the_moon")).toBeDefined();
  });

  it("unlocks Rock Bottom when a single day nets -75 or worse", () => {
    const elo = [
      makeElo({ elo_change: -40, created_at: onDay(0, 1) }),
      makeElo({ elo_change: -40, created_at: onDay(0, 2) }),
    ];
    const r = computeAchievementsForPlayer("p1", makePlayer(), [], [], elo);
    expect(r.find((a) => a.achievementId === "rock_bottom")).toBeDefined();
  });

  it("does not combine gains across different days", () => {
    const elo = [
      makeElo({ elo_change: 60, created_at: onDay(0, 1) }),
      makeElo({ elo_change: 60, created_at: onDay(1, 1) }),
    ];
    const r = computeAchievementsForPlayer("p1", makePlayer(), [], [], elo);
    expect(r.find((a) => a.achievementId === "to_the_moon")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Carrying Hard / Deadweight (partner ELO gap on a win)
// ---------------------------------------------------------------------------

describe("carrying_hard and deadweight achievements", () => {
  const winMatch = [makeMatch({ id: "cw1", winning_team: "A", created_at: onDay(0, 1) })];

  it("unlocks Carrying Hard when the partner is 200+ below", () => {
    const elo = [
      makeElo({ match_id: "cw1", player_id: "p1", elo_before: 1600 }),
      makeElo({ match_id: "cw1", player_id: "p2", elo_before: 1390 }),
    ];
    const r = computeAchievementsForPlayer("p1", makePlayer(), winMatch, [], elo);
    const ch = r.find((a) => a.achievementId === "carrying_hard");
    expect(ch).toBeDefined();
    expect(ch!.meta?.partnerId).toBe("p2");
  });

  it("unlocks Deadweight when the partner is 200+ above", () => {
    const elo = [
      makeElo({ match_id: "cw1", player_id: "p1", elo_before: 1600 }),
      makeElo({ match_id: "cw1", player_id: "p2", elo_before: 1820 }),
    ];
    const r = computeAchievementsForPlayer("p1", makePlayer(), winMatch, [], elo);
    expect(r.find((a) => a.achievementId === "deadweight")).toBeDefined();
  });

  it("does not unlock on a loss even with a big gap", () => {
    const lossMatch = [makeMatch({ id: "cl1", winning_team: "B", created_at: onDay(0, 1) })];
    const elo = [
      makeElo({ match_id: "cl1", player_id: "p1", elo_before: 1600 }),
      makeElo({ match_id: "cl1", player_id: "p2", elo_before: 1390 }),
    ];
    const r = computeAchievementsForPlayer("p1", makePlayer(), lossMatch, [], elo);
    expect(r.find((a) => a.achievementId === "carrying_hard")).toBeUndefined();
    expect(r.find((a) => a.achievementId === "deadweight")).toBeUndefined();
  });
});
