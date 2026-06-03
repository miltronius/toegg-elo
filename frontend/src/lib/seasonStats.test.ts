import { describe, it, expect } from "vitest";
import { computeSeasonStats } from "./seasonStats";
import type { Match, Player, EloHistory } from "./supabase";
import type { PlayerAchievementRow } from "./achievements";

function makePlayer(id: string, name = id): Player {
  return {
    id,
    name,
    current_elo: 1500,
    matches_played: 0,
    wins: 0,
    losses: 0,
    created_at: "",
    anonymous_name: null,
  };
}

let mc = 0;
function makeMatch(o: Partial<Match> = {}): Match {
  return {
    id: `m${++mc}`,
    team_a_player_1_id: "p1",
    team_a_player_2_id: "p2",
    team_b_player_1_id: "p3",
    team_b_player_2_id: "p4",
    winning_team: "A",
    season_id: "s1",
    created_at: "2024-01-15T10:00:00Z", // Monday
    ...o,
  };
}

let ec = 0;
function makeElo(o: Partial<EloHistory> = {}): EloHistory {
  return {
    id: `e${++ec}`,
    player_id: "p1",
    match_id: "m1",
    season_id: "s1",
    elo_before: 1500,
    elo_after: 1500,
    elo_change: 0,
    created_at: "2024-01-15T10:00:00Z",
    ...o,
  };
}

const players = [
  makePlayer("p1", "Alice"),
  makePlayer("p2", "Bob"),
  makePlayer("p3", "Cara"),
  makePlayer("p4", "Dan"),
];

describe("computeSeasonStats", () => {
  it("counts games and distinct active players for the season", () => {
    const matches = [makeMatch(), makeMatch(), makeMatch({ season_id: "s2" })];
    const r = computeSeasonStats("s1", matches, [], players);
    expect(r.gamesPlayed).toBe(2);
    expect(r.activePlayers).toBe(4);
  });

  it("buckets matches by weekday (Mon–Fri)", () => {
    const matches = [
      makeMatch({ created_at: "2024-01-15T10:00:00Z" }), // Mon
      makeMatch({ created_at: "2024-01-15T12:00:00Z" }), // Mon
      makeMatch({ created_at: "2024-01-17T10:00:00Z" }), // Wed
    ];
    const r = computeSeasonStats("s1", matches, [], players);
    expect(r.weekday.find((w) => w.day === "Mon")?.games).toBe(2);
    expect(r.weekday.find((w) => w.day === "Wed")?.games).toBe(1);
    expect(r.weekday.find((w) => w.day === "Fri")?.games).toBe(0);
  });

  it("finds the longest win streak across players", () => {
    // p1 (team A) wins three in a row, then loses
    const matches = [
      makeMatch({ created_at: "2024-01-15T10:00:00Z", winning_team: "A" }),
      makeMatch({ created_at: "2024-01-15T11:00:00Z", winning_team: "A" }),
      makeMatch({ created_at: "2024-01-15T12:00:00Z", winning_team: "A" }),
      makeMatch({ created_at: "2024-01-15T13:00:00Z", winning_team: "B" }),
    ];
    const r = computeSeasonStats("s1", matches, [], players);
    expect(r.topStreak).toEqual({ name: "Alice", streak: 3 });
  });

  it("finds the longest lose streak across players", () => {
    // p3 (team B) loses three in a row, then wins
    const matches = [
      makeMatch({ created_at: "2024-01-15T10:00:00Z", winning_team: "A" }),
      makeMatch({ created_at: "2024-01-15T11:00:00Z", winning_team: "A" }),
      makeMatch({ created_at: "2024-01-15T12:00:00Z", winning_team: "A" }),
      makeMatch({ created_at: "2024-01-15T13:00:00Z", winning_team: "B" }),
    ];
    const r = computeSeasonStats("s1", matches, [], players);
    expect(r.topLoseStreak).toEqual({ name: "Cara", streak: 3 });
  });

  it("finds the best single-day ELO gain and biggest single win", () => {
    const history = [
      makeElo({ player_id: "p1", elo_change: 30, created_at: "2024-01-15T10:00:00Z" }),
      makeElo({ player_id: "p1", elo_change: 40, created_at: "2024-01-15T11:00:00Z" }),
      // different day, smaller
      makeElo({ player_id: "p2", elo_change: 50, created_at: "2024-01-16T10:00:00Z" }),
    ];
    const r = computeSeasonStats("s1", [], history, players);
    expect(r.bestDayGain).toEqual({ name: "Alice", day: "2024-01-15", gain: 70 });
    expect(r.biggestWin).toEqual({ name: "Bob", gain: 50 });
  });

  it("finds the worst single-day ELO drop and biggest single loss", () => {
    const history = [
      makeElo({ player_id: "p1", elo_change: -20, created_at: "2024-01-15T10:00:00Z" }),
      makeElo({ player_id: "p1", elo_change: -25, created_at: "2024-01-15T11:00:00Z" }),
      // different day, bigger single drop
      makeElo({ player_id: "p2", elo_change: -40, created_at: "2024-01-16T10:00:00Z" }),
    ];
    const r = computeSeasonStats("s1", [], history, players);
    expect(r.worstDayDrop).toEqual({ name: "Alice", day: "2024-01-15", drop: 45 });
    expect(r.biggestLoss).toEqual({ name: "Bob", drop: 40 });
  });

  it("reports raw highest/lowest ELO for the all-time scope", () => {
    const history = [
      makeElo({ player_id: "p1", elo_after: 1620, created_at: "2024-01-15T10:00:00Z" }),
      makeElo({ player_id: "p2", elo_after: 1410, created_at: "2024-01-16T10:00:00Z" }),
    ];
    const r = computeSeasonStats(null, [], history, players);
    expect(r.highestElo).toEqual({ name: "Alice", elo: 1620 });
    expect(r.lowestElo).toEqual({ name: "Bob", elo: 1410 });
  });

  it("season-normalizes highest/lowest ELO to a 1500 start per player", () => {
    // Alice starts a season at 1800 all-time, climbs to 1850 → normalized 1550.
    const history = [
      makeElo({
        player_id: "p1",
        elo_before: 1800,
        elo_after: 1850,
        created_at: "2024-01-15T10:00:00Z",
      }),
    ];
    const r = computeSeasonStats("s1", [], history, players);
    expect(r.highestElo).toEqual({ name: "Alice", elo: 1550 });
    expect(r.lowestElo).toEqual({ name: "Alice", elo: 1550 });
  });

  it("ignores inactivity-penalty rows (match_id null) for ELO stats", () => {
    const history = [
      makeElo({ player_id: "p1", match_id: null, elo_change: 80 }),
    ];
    const r = computeSeasonStats("s1", [], history, players);
    expect(r.biggestWin).toBeNull();
    expect(r.bestDayGain).toBeNull();
  });

  it("reports per-day activity and the first/last active day", () => {
    const matches = [
      makeMatch({ created_at: "2024-01-15T10:00:00Z" }),
      makeMatch({ created_at: "2024-01-15T12:00:00Z" }),
      makeMatch({ created_at: "2024-01-18T09:00:00Z" }),
    ];
    const r = computeSeasonStats("s1", matches, [], players);
    expect(r.activity).toEqual([
      { day: "2024-01-15", games: 2 },
      { day: "2024-01-18", games: 1 },
    ]);
    expect(r.dateRange).toEqual({ start: "2024-01-15", end: "2024-01-18" });
  });

  it("returns a null date range when there is no activity", () => {
    const r = computeSeasonStats("s1", [], [], players);
    expect(r.activity).toEqual([]);
    expect(r.dateRange).toBeNull();
  });

  it("aggregates across all seasons when seasonId is null", () => {
    const matches = [makeMatch({ season_id: "s1" }), makeMatch({ season_id: "s2" })];
    const r = computeSeasonStats(null, matches, [], players);
    expect(r.gamesPlayed).toBe(2);
  });

  it("finds the win-rate leader among players with enough games", () => {
    // p1 & p2 (team A) win all 6; p3 & p4 lose all 6. minGames = max(3, 3) = 3.
    const matches = Array.from({ length: 6 }, (_, i) =>
      makeMatch({ created_at: `2024-01-15T${10 + i}:00:00Z`, winning_team: "A" }),
    );
    const r = computeSeasonStats("s1", matches, [], players);
    expect(r.winRateLeader).toEqual({
      name: "Alice",
      winrate: 100,
      games: 6,
      minGames: 3,
    });
  });

  it("counts achievements unlocked within the season window, and all-time", () => {
    const ach = (id: string, unlocked_at: string): PlayerAchievementRow => ({
      id,
      player_id: "p1",
      achievement_id: "win_1",
      unlocked_at,
      meta: null,
    });
    const achievements = [
      ach("a1", "2024-01-10T10:00:00Z"), // before window
      ach("a2", "2024-02-01T10:00:00Z"), // in window
      ach("a3", "2024-02-15T10:00:00Z"), // in window
      ach("a4", "2024-03-05T10:00:00Z"), // after window (ended)
    ];
    const bounds = {
      startedAt: "2024-01-20T00:00:00Z",
      endedAt: "2024-03-01T00:00:00Z",
    };
    const seasonR = computeSeasonStats("s1", [], [], players, achievements, bounds);
    expect(seasonR.achievementsUnlocked).toBe(2);

    const allR = computeSeasonStats(null, [], [], players, achievements);
    expect(allR.achievementsUnlocked).toBe(4);
  });
});
