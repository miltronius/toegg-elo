import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AchievementGallery, Achievements } from "./Achievements";
import {
  buildAchievementStatuses,
  type PlayerAchievementRow,
} from "../lib/achievements";
import type { Player, Season } from "../lib/supabase";

// Nobody by default, as outside an AuthProvider; the comparison tests sign in.
const me = vi.hoisted(() => ({
  role: null as string | null,
  myPlayerId: null as string | null,
  refreshMyPlayer: async () => {},
}));
vi.mock("../contexts/AuthContext", () => ({ useMe: () => me }));
afterEach(() => {
  me.role = null;
  me.myPlayerId = null;
});

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
    // Several picked: emoji-only badges, the names kept for screen readers.
    expect(trigger.querySelectorAll(".cat-badge--compact")).toHaveLength(2);
    expect(trigger).toHaveTextContent("Season");

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

  it("filters to a row's category when its badge is clicked", async () => {
    renderOverview();
    await userEvent.click(
      screen.getAllByRole("button", { name: "Show only Season" })[0],
    );
    expect(screen.getByText("Season Champion")).toBeInTheDocument();
    expect(screen.queryByText("Flawless Victory")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Filter by category" }),
    ).toHaveTextContent("Season");
  });
});

describe("Achievements overview - compare players", () => {
  const named = (id: string, name: string): Player => ({ ...player, id, name });
  const PLAYERS = [player, named("p2", "Ben"), named("p3", "Carla")];
  // Anna (p1) was champion twice; Ben won his first match.
  const ROWS: PlayerAchievementRow[] = [
    champion("s1", "2026-04-04T00:00:00Z"),
    champion("s2", "2026-05-30T00:00:00Z"),
    {
      id: "w1",
      player_id: "p2",
      achievement_id: "win_1",
      unlocked_at: "2026-03-10T00:00:00Z",
      meta: null,
      season_id: null,
    },
  ];
  const renderOverview = () =>
    render(
      <Achievements
        players={PLAYERS}
        matches={[]}
        allAchievementRows={ROWS}
        eloHistory={[]}
        onSelectPlayer={() => {}}
      />,
    );
  const row = (name: string) =>
    screen.getByText(name).closest(".achievements-overview-row") as HTMLElement;
  const addPlayer = async (name: string) => {
    await userEvent.click(screen.getByPlaceholderText("+ Compare with…"));
    await userEvent.click(screen.getByRole("option", { name: new RegExp(`^${name}`) }));
  };

  it("marks what you have earned and what not yet", () => {
    me.role = "user";
    me.myPlayerId = "p1";
    renderOverview();
    expect(screen.getByText("Me")).toBeInTheDocument();
    const champ = within(row("Season Champion")).getByRole("img", { name: /^Me: earned/ });
    expect(champ).toHaveTextContent("×2");
    expect(champ).toHaveAccessibleName("Me: earned 30.05.2026");
    expect(
      within(row("First Victory")).getByRole("img", { name: "Me: not yet" }),
    ).toBeInTheDocument();
  });

  it("tints the rows you have earned, whoever else is compared", async () => {
    me.role = "user";
    me.myPlayerId = "p1";
    renderOverview();
    await addPlayer("Ben");
    expect(row("Season Champion")).toHaveClass("is-mine");
    // Ben has it, you don't.
    expect(row("First Victory")).not.toHaveClass("is-mine");
  });

  it("adds as many players as you like, and removes them again", async () => {
    me.role = "user";
    me.myPlayerId = "p1";
    renderOverview();
    await addPlayer("Ben");
    await addPlayer("Carla");
    const victory = within(row("First Victory"));
    expect(victory.getByRole("img", { name: /^Ben: earned/ })).toBeInTheDocument();
    expect(victory.getByRole("img", { name: "Carla: not yet" })).toBeInTheDocument();
    // Columns in the order added, after yours.
    expect(
      victory.getAllByRole("img").map((c) => c.getAttribute("aria-label")?.split(":")[0]),
    ).toEqual(["Me", "Ben", "Carla"]);

    // Nobody twice, and never yourself.
    await userEvent.click(screen.getByPlaceholderText("+ Compare with…"));
    expect(screen.queryByRole("option")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Remove Ben from the comparison" }));
    expect(within(row("First Victory")).queryByRole("img", { name: /^Ben/ })).toBeNull();
    expect(within(row("First Victory")).getByRole("img", { name: "Carla: not yet" })).toBeInTheDocument();
  });

  it("compares without a Me column when your account has no player", async () => {
    me.role = "user";
    renderOverview();
    expect(screen.queryByText("Me")).toBeNull();
    expect(within(row("First Victory")).queryByRole("img")).toBeNull();
    await addPlayer("Anna");
    expect(
      within(row("Season Champion")).getByRole("img", { name: /^Anna: earned/ }),
    ).toBeInTheDocument();
  });
});
