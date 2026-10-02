import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Timeline } from "./Timeline";
import type { Match, Player, Season } from "../lib/supabase";

const player = (id: string, name: string): Player => ({
  id,
  name,
  current_elo: 1500,
  matches_played: 0,
  wins: 0,
  losses: 0,
  created_at: "2026-01-01T00:00:00Z",
  anonymous_name: null,
  is_linked: false,
});
const PLAYERS = [player("a", "Anna"), player("b", "Ben"), player("c", "Carla"), player("d", "Dario")];

const season = (over: Partial<Season>): Season => ({
  id: "s1",
  number: 1,
  name: "Spring",
  k_factor: 48,
  partner_weight: 0.25,
  inactivity_penalty_percent: 0,
  started_at: "2026-04-04T10:00:00Z",
  ended_at: null,
  is_active: false,
  created_at: "2026-04-04T10:00:00Z",
  ...over,
});
// S1 ran 04.04.-01.06.2026; S2 runs since then, with a planned end.
const S1 = season({ ended_at: "2026-06-01T08:00:00Z" });
const S2 = season({
  id: "s2",
  number: 2,
  name: "Summer",
  started_at: "2026-06-01T08:00:00Z",
  is_active: true,
  planned_end_at: "2026-08-31T18:00:00Z",
});

const match = (id: string, seasonId: string, createdAt: string): Match => ({
  id,
  team_a_player_1_id: "a",
  team_a_player_2_id: "b",
  team_b_player_1_id: "c",
  team_b_player_2_id: "d",
  winning_team: "A",
  team_a_games: 2,
  team_b_games: 0,
  games: null,
  season_id: seasonId,
  created_at: createdAt,
});

function renderTimeline() {
  render(
    <Timeline
      players={PLAYERS}
      matches={[match("m1", "s1", "2026-04-10T12:00:00Z"), match("m2", "s2", "2026-07-01T12:00:00Z")]}
      eloHistory={new Map()}
      allAchievementRows={[]}
      seasons={[S1, S2]}
    />,
  );
}

describe("Timeline seasons", () => {
  it("puts a band with its dates above each season's days, newest first", () => {
    renderTimeline();
    const s2 = document.getElementById("timeline-season-2")!;
    const s1 = document.getElementById("timeline-season-1")!;
    expect(s2).toHaveTextContent("S2 · Summer");
    expect(s2).toHaveTextContent("Since 01.06.2026 · planned end 31.08.2026");
    expect(s1).toHaveTextContent("04.04.2026 – 01.06.2026");
    expect(s2.compareDocumentPosition(s1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows where seasons start and end", () => {
    renderTimeline();
    // The first season's start has no transition to announce it.
    expect(screen.getByText("S1 · Spring started")).toBeInTheDocument();
    expect(screen.getByText("S1 · Spring ended")).toBeInTheDocument();
    expect(screen.getByText("S2 · Summer started")).toBeInTheDocument();
  });

  it("lists the seasons in a list of contents", () => {
    renderTimeline();
    const nav = screen.getByRole("navigation", { name: "Seasons" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "#timeline-season-2",
      "#timeline-season-1",
    ]);
    expect(links[1]).toHaveTextContent("S1 · Spring04.04.2026 – 01.06.2026");
  });
});
