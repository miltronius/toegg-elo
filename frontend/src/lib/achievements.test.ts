import { describe, it, expect } from "vitest";
import { computeAchievementsForPlayer } from "./achievements";
import type { Match, Player } from "./supabase";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayer(id = "p1"): Player {
  return { id, name: "Test", current_elo: 1500, matches_played: 0, wins: 0, losses: 0, created_at: "" };
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
