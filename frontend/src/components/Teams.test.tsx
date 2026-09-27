import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Teams } from "./Teams";
import type { Match, Player } from "../lib/supabase";

// Who "you" are: tests that care set me.myPlayerId; everyone else is nobody.
const me = vi.hoisted(() => ({
  role: null,
  myPlayerId: null as string | null,
  refreshMyPlayer: async () => {},
}));
vi.mock("../contexts/AuthContext", () => ({ useMe: () => me }));
afterEach(() => {
  me.myPlayerId = null;
  localStorage.clear();
});

const player = (id: string, name: string): Player => ({
  id,
  name,
  current_elo: 1500,
  matches_played: 2,
  wins: 1,
  losses: 1,
  created_at: "2024-01-01T00:00:00Z",
  anonymous_name: null,
  is_linked: false,
});

const PLAYERS = [
  player("p1", "Ann"),
  player("p2", "Bob"),
  player("p3", "Cid"),
  player("p4", "Dee"),
];

// Two matches between the same pairs: teams only show from 2 matches up.
const match = (id: string, winning_team: "A" | "B"): Match => ({
  id,
  team_a_player_1_id: "p1",
  team_a_player_2_id: "p2",
  team_b_player_1_id: "p3",
  team_b_player_2_id: "p4",
  winning_team,
  team_a_games: winning_team === "A" ? 1 : 0,
  team_b_games: winning_team === "B" ? 1 : 0,
  games: null,
  season_id: null,
  created_at: "2024-01-15T10:00:00Z",
});

const renderTeams = () =>
  render(
    <Teams
      matches={[match("m1", "A"), match("m2", "B")]}
      players={PLAYERS}
      teamNames={[]}
      seasons={[]}
      selectedSeason={null}
      onSeasonSelect={vi.fn()}
      onTeamClick={vi.fn()}
    />,
  );

const YOUR_TEAM = "Your team";

describe("Teams - your teams", () => {
  it("highlights the table rows of teams you play in", () => {
    me.myPlayerId = "p1";
    renderTeams();

    const mine = screen
      .getAllByRole("row")
      .filter((r) => r.classList.contains("row-me"));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toHaveTextContent("Ann");
    expect(mine[0]).toHaveTextContent("Bob");
    expect(screen.getAllByTitle(YOUR_TEAM)).toHaveLength(1);
  });

  it("highlights your team's card too", () => {
    localStorage.setItem("teams-view", "card");
    me.myPlayerId = "p1";
    const { container } = renderTeams();

    const mine = container.querySelectorAll(".team-card-me");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toHaveTextContent("Ann");
    expect(screen.getAllByTitle(YOUR_TEAM)).toHaveLength(1);
  });

  it("highlights nothing when you have no player", () => {
    renderTeams();

    expect(
      screen.getAllByRole("row").some((r) => r.classList.contains("row-me")),
    ).toBe(false);
    expect(screen.queryByTitle(YOUR_TEAM)).not.toBeInTheDocument();
  });
});
