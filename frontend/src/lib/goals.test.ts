import { describe, it, expect } from "vitest";
import { isFullyScored, playerGoalTally } from "./goals";
import { computeTeamStats } from "./teamUtils";
import type { Match, MatchGame, Player } from "./supabase";

function makeMatch(seq: number, games: MatchGame[] | null, winning_team: "A" | "B" = "A"): Match {
  return {
    id: `m${seq}`,
    team_a_player_1_id: "p1",
    team_a_player_2_id: "p2",
    team_b_player_1_id: "p3",
    team_b_player_2_id: "p4",
    winning_team,
    team_a_games: games ? games.filter((g) => g.w === "A").length : winning_team === "A" ? 1 : 0,
    team_b_games: games ? games.filter((g) => g.w === "B").length : winning_team === "B" ? 1 : 0,
    games,
    season_id: null,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, seq)).toISOString(),
  };
}

describe("isFullyScored", () => {
  it("needs every loser's score; the winner's 10 may be left empty", () => {
    expect(isFullyScored(makeMatch(1, [{ w: "A", a: null, b: 4 }]))).toBe(true);
    expect(isFullyScored(makeMatch(1, [{ w: "A", a: 10, b: null }]))).toBe(false);
    expect(isFullyScored(makeMatch(1, null))).toBe(false);
  });
});

describe("playerGoalTally", () => {
  it("adds scored and received from the player's side, exact when fully scored", () => {
    const matches = [
      makeMatch(1, [{ w: "A", a: 10, b: 7 }, { w: "B", a: 3, b: null }], "B"),
      makeMatch(2, [{ w: "A", a: null, b: 0 }]),
    ];
    expect(playerGoalTally("p1", matches)).toEqual({ scored: 23, received: 17, exact: true });
    expect(playerGoalTally("p4", matches)).toEqual({ scored: 17, received: 23, exact: true });
  });

  it("is only a floor once a loser's score is missing", () => {
    const matches = [makeMatch(1, [{ w: "A", a: null, b: null }]), makeMatch(2, null, "B")];
    expect(playerGoalTally("p1", matches)).toEqual({ scored: 10, received: 10, exact: false });
  });

  it("ignores matches the player wasn't in", () => {
    expect(playerGoalTally("p9", [makeMatch(1, null)])).toEqual({ scored: 0, received: 0, exact: true });
  });
});

describe("computeTeamStats goals", () => {
  it("tallies each pairing from its own side", () => {
    const players = ["p1", "p2", "p3", "p4"].map(
      (id) => ({ id, name: id, current_elo: 1500 }) as Player,
    );
    const teams = computeTeamStats(
      [makeMatch(1, [{ w: "A", a: 10, b: 6 }]), makeMatch(2, [{ w: "B", a: 2, b: 10 }], "B")],
      players,
      [],
    );
    expect(teams.find((t) => t.key === "p1:p2")?.goals).toEqual({ scored: 12, received: 16, exact: true });
    expect(teams.find((t) => t.key === "p3:p4")?.goals).toEqual({ scored: 16, received: 12, exact: true });
  });
});
