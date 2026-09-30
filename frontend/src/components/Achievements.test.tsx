import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AchievementGallery } from "./Achievements";
import {
  buildAchievementStatuses,
  type PlayerAchievementRow,
} from "../lib/achievements";
import type { Player, Season } from "../lib/supabase";

const player: Player = {
  id: "p1",
  name: "Anna",
  current_elo: 1500,
  matches_played: 0,
  wins: 0,
  losses: 0,
  created_at: "",
  anonymous_name: null,
  is_linked: false,
};

const season = (id: string, number: number) =>
  ({ id, number, name: `Season ${number}` }) as Season;

const champion = (season_id: string, unlocked_at: string): PlayerAchievementRow => ({
  id: `champ-${season_id}`,
  player_id: "p1",
  achievement_id: "season_top_1",
  unlocked_at,
  meta: null,
  season_id,
});

describe("AchievementGallery - per-season achievements", () => {
  it("shows a repeat as xN with its seasons in the unlock label", () => {
    const rows = [
      champion("s1", "2026-04-04T00:00:00Z"),
      champion("s2", "2026-05-30T00:00:00Z"),
    ];
    const statuses = buildAchievementStatuses("p1", player, [player], [], rows);

    render(
      <AchievementGallery
        statuses={statuses}
        players={[player]}
        playerId="p1"
        matches={[]}
        eloHistory={[]}
        seasons={[season("s1", 1), season("s2", 2)]}
      />,
    );

    const name = screen.getByText("Season Champion");
    expect(name).toHaveTextContent("×2");
    const card = name.closest(".achievement-card")!;
    // One hover label, not a second native tooltip on top of it.
    expect(card).not.toHaveAttribute("title");
    expect(card.getAttribute("data-unlocked")).toBe(
      "30.05.2026 · Season 1, Season 2",
    );
  });
});
