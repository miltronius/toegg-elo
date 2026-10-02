import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AchievementGallery, Achievements } from "./Achievements";
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

const champion = (
  season_id: string,
  unlocked_at: string,
): PlayerAchievementRow => ({
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

describe("AchievementGallery - category filter", () => {
  const rows: PlayerAchievementRow[] = [champion("s1", "2026-04-04T00:00:00Z")];
  const renderGallery = () =>
    render(
      <AchievementGallery
        statuses={buildAchievementStatuses("p1", player, [player], [], rows)}
        players={[player]}
        playerId="p1"
        matches={[]}
        eloHistory={[]}
        seasons={[season("s1", 1)]}
      />,
    );

  it("shows unlocked/total per category", async () => {
    renderGallery();
    await userEvent.click(
      screen.getByRole("button", { name: "Filter by category" }),
    );
    const option = screen.getByRole("option", { name: /Season/ });
    expect(option).toHaveTextContent("1/7");
  });

  it("hides other categories, and All restores them", async () => {
    renderGallery();
    expect(screen.getByText("Flawless Victory")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Filter by category" }),
    );
    await userEvent.click(screen.getByRole("option", { name: /Season/ }));

    expect(screen.getByText("Season Champion")).toBeInTheDocument();
    expect(screen.getByText("Podium")).toBeInTheDocument();
    expect(screen.queryByText("Flawless Victory")).not.toBeInTheDocument();

    // Adding a second category widens the filter.
    await userEvent.click(screen.getByRole("option", { name: /Goals/ }));
    expect(screen.getByText("Flawless Victory")).toBeInTheDocument();
    expect(screen.queryByText("First Victory")).not.toBeInTheDocument();

    const all = screen.getByRole("option", { name: /All categories/ });
    await userEvent.click(all);
    expect(all).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("First Victory")).toBeInTheDocument();
  });

  it("works from the keyboard and closes on Escape", async () => {
    renderGallery();
    const trigger = screen.getByRole("button", { name: "Filter by category" });
    await userEvent.click(trigger);
    // Down past "All categories" to Wins & Losses, then toggle it.
    await userEvent.keyboard("{ArrowDown} ");
    const listbox = screen.getByRole("listbox");
    expect(
      within(listbox).getByRole("option", { name: /Wins & Losses/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Flawless Victory")).not.toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveTextContent("Wins & Losses");
  });

  it("clears every category from the x on the closed dropdown", async () => {
    renderGallery();
    expect(
      screen.queryByRole("button", { name: "Clear category filter" }),
    ).not.toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "Filter by category" });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("option", { name: /Season/ }));
    await userEvent.click(screen.getByRole("option", { name: /Goals/ }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByText("First Victory")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Clear category filter" }),
    );
    expect(screen.getByText("First Victory")).toBeInTheDocument();
    expect(trigger).toHaveTextContent("All categories");
    expect(trigger).toHaveFocus();
    expect(
      screen.queryByRole("button", { name: "Clear category filter" }),
    ).not.toBeInTheDocument();
  });
});

describe("Achievements overview - category column", () => {
  const renderOverview = () =>
    render(
      <Achievements
        players={[player]}
        matches={[]}
        allAchievementRows={[champion("s1", "2026-04-04T00:00:00Z")]}
        eloHistory={[]}
        onSelectPlayer={() => {}}
      />,
    );

  it("shows each achievement's category and filters by it", async () => {
    renderOverview();
    const row = screen
      .getByText("Season Champion")
      .closest(".achievements-overview-row")!;
    expect(row.querySelector(".cat-badge--season")).toHaveTextContent("Season");

    // The filter heads the column, not the card header.
    const trigger = screen.getByRole("button", { name: "Filter by category" });
    expect(trigger.closest(".achievements-overview-head")).not.toBeNull();

    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("option", { name: /Goals/ }));
    expect(screen.getByText("Flawless Victory")).toBeInTheDocument();
    expect(screen.queryByText("Season Champion")).not.toBeInTheDocument();
  });
});
