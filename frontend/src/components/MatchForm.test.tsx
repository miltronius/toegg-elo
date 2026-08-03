import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Player } from "../lib/supabase";

// lib/supabase builds a real client at import time, which fails without env
// vars - and the form only needs recordMatch from it.
const recordMatch = vi.fn().mockResolvedValue({ success: true });
vi.mock("../lib/supabase", () => ({
  recordMatch: (...args: unknown[]) => recordMatch(...args),
}));

const { MatchForm } = await import("./MatchForm");

const player = (id: string, name: string, elo = 1500): Player => ({
  id,
  name,
  current_elo: elo,
  matches_played: 0,
  wins: 0,
  losses: 0,
  created_at: "2026-01-01T00:00:00Z",
  anonymous_name: null,
});

const PLAYERS = [
  player("p1", "Ann"),
  player("p2", "Bob"),
  player("p3", "Cid"),
  player("p4", "Dee"),
];

function setup(players: Player[] = PLAYERS) {
  const onMatchRecorded = vi.fn();
  render(
    <MatchForm
      players={players}
      onMatchRecorded={onMatchRecorded}
      kFactor={32}
      // Pinned rather than DEFAULT_PARTNER_WEIGHT: the expected strings below
      // are worked out by hand from it, so a future change to the default
      // should not fail tests that are only about how the blend is rendered.
      partnerWeight={0.25}
    />,
  );
  return { onMatchRecorded, user: userEvent.setup() };
}

/** Fill the four player pickers, which are the only comboboxes on the form. */
async function pickPlayers(user: ReturnType<typeof userEvent.setup>) {
  const names = ["Ann", "Bob", "Cid", "Dee"];
  for (const name of names) {
    // Each pick removes that player from the remaining lists, so the boxes are
    // re-read every iteration.
    const boxes = screen.getAllByRole("combobox");
    const box = boxes.find((b) => (b as HTMLInputElement).value === "")!;
    await user.click(box);
    await user.type(box, name);
    await user.click(await screen.findByRole("option", { name: new RegExp(name) }));
  }
}

// Scoped to the Games fieldset: the team Elo tooltips are lists too, and in
// jsdom nothing is hidden by CSS, so an unscoped listitem query catches them.
const gamesGroup = () => screen.getByRole("group", { name: "Games" });
const gameRows = () => within(gamesGroup()).getAllByRole("listitem");

const submitButton = () =>
  screen.getByRole("button", { name: "Record Match", hidden: false });

beforeEach(() => recordMatch.mockClear());

describe("MatchForm series entry", () => {
  it("opens on three game rows", () => {
    setup();
    expect(gameRows()).toHaveLength(3);
  });

  it("adds and removes game rows", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /Add game/ }));
    expect(gameRows()).toHaveLength(4);

    await user.click(screen.getByRole("button", { name: "Remove game 2" }));
    expect(gameRows()).toHaveLength(3);
  });

  it("never lets the last game row be removed", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Remove game 3" }));
    await user.click(screen.getByRole("button", { name: "Remove game 2" }));
    expect(gameRows()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Remove game 1" })).toBeDisabled();
  });

  it("suggests a full game as the placeholder once a winner is picked", async () => {
    const { user } = setup();
    const row = gameRows()[0];
    const [aGoals, bGoals] = within(row).getAllByRole("spinbutton");

    expect(aGoals).toHaveAttribute("placeholder", "0");
    expect(bGoals).toHaveAttribute("placeholder", "0");

    await user.click(
      within(row).getByRole("button", { name: /Team B won game 1/ }),
    );
    expect(aGoals).toHaveAttribute("placeholder", "0");
    expect(bGoals).toHaveAttribute("placeholder", "10");
  });

  it("ignores rows nobody touched", async () => {
    const { user, onMatchRecorded } = setup();
    await pickPlayers(user);

    // A 2-0 sweep: the third row is left alone rather than deleted.
    await user.click(
      within(gameRows()[0]).getByRole("button", { name: /Team A won game 1/ }),
    );
    await user.click(
      within(gameRows()[1]).getByRole("button", { name: /Team A won game 2/ }),
    );

    expect(screen.getByText("Series").parentElement).toHaveTextContent("2 - 0");
    await user.click(submitButton());

    expect(recordMatch).toHaveBeenCalledWith("p1", "p2", "p3", "p4", [
      { w: "A", a: null, b: null },
      { w: "A", a: null, b: null },
    ]);
    expect(onMatchRecorded).toHaveBeenCalled();
  });

  it("still demands a winner for a row with a half-typed score", async () => {
    const { user } = setup();
    await pickPlayers(user);

    await user.click(
      within(gameRows()[0]).getByRole("button", { name: /Team A won game 1/ }),
    );
    // Row 2 has a goal count but no decidable winner - not blank, so it counts.
    const [a2] = within(gameRows()[1]).getAllByRole("spinbutton");
    await user.type(a2, "10");

    expect(submitButton()).toBeDisabled();
  });

  it("blocks submission while no game has been recorded", async () => {
    const { user } = setup();
    await pickPlayers(user);
    expect(submitButton()).toBeDisabled();
  });

  it("derives the winner from a score and locks the manual toggle", async () => {
    const { user } = setup();
    const row = gameRows()[0];
    const [aGoals, bGoals] = within(row).getAllByRole("spinbutton");

    await user.type(aGoals, "10");
    await user.type(bGoals, "7");

    const [teamAWon, teamBWon] = within(row).getAllByRole("button", {
      name: /won game 1/,
    });
    expect(teamAWon).toHaveAttribute("aria-pressed", "true");
    expect(teamBWon).toHaveAttribute("aria-pressed", "false");
    expect(teamAWon).toBeDisabled();
    expect(teamBWon).toBeDisabled();
  });

  it("rejects a game that ends level", async () => {
    const { user } = setup();
    const row = gameRows()[0];
    const [aGoals, bGoals] = within(row).getAllByRole("spinbutton");

    await user.type(aGoals, "8");
    await user.type(bGoals, "8");

    expect(within(row).getByText("A game can't end level")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("blocks submission while the series is level", async () => {
    const { user } = setup();
    await pickPlayers(user);

    await user.click(
      within(gameRows()[0]).getByRole("button", { name: /Team A won game 1/ }),
    );
    await user.click(
      within(gameRows()[1]).getByRole("button", { name: /Team B won game 2/ }),
    );

    expect(screen.getByText(/A match can't end level/)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("submits a 2-1 series with mixed scored and unscored games", async () => {
    const { user, onMatchRecorded } = setup();
    await pickPlayers(user);

    // Game 1 by score, game 2 by score the other way, game 3 by winner only.
    const [g1, g2, g3] = gameRows();
    const [a1, b1] = within(g1).getAllByRole("spinbutton");
    await user.type(a1, "10");
    await user.type(b1, "6");

    const [a2, b2] = within(g2).getAllByRole("spinbutton");
    await user.type(a2, "8");
    await user.type(b2, "10");

    await user.click(
      within(g3).getByRole("button", { name: /Team A won game 3/ }),
    );

    // The tally is split across elements, so read the whole "Series" line.
    expect(screen.getByText("Series").parentElement).toHaveTextContent("2 - 1");

    await user.click(submitButton());

    expect(recordMatch).toHaveBeenCalledWith("p1", "p2", "p3", "p4", [
      { w: "A", a: 10, b: 6 },
      { w: "B", a: 8, b: 10 },
      { w: "A", a: null, b: null },
    ]);
    expect(onMatchRecorded).toHaveBeenCalled();
  });

  describe("team Elo breakdown", () => {
    it("is absent until all four players are picked", async () => {
      const { user } = setup();
      expect(screen.queryAllByRole("tooltip")).toHaveLength(0);

      await pickPlayers(user);
      expect(screen.getAllByRole("tooltip")).toHaveLength(2);
    });

    it("shows the team average and the per-player blend", async () => {
      const { user } = setup([
        player("p1", "Ann", 1900),
        player("p2", "Bob", 1100),
        player("p3", "Cid", 1500),
        player("p4", "Dee", 1500),
      ]);
      await pickPlayers(user);

      const [teamA] = screen.getAllByRole("tooltip");

      // Both teams average 1500 - the blend moves credit between partners but
      // leaves their sum, and so the team average, untouched.
      expect(teamA).toHaveTextContent("(1900 + 1100) ÷ 2");
      // 0.75x1900 + 0.25x1100 = 1700, and the mirror for Bob.
      expect(teamA).toHaveTextContent("0.75×1900 + 0.25×1100 = 1700");
      expect(teamA).toHaveTextContent("0.75×1100 + 0.25×1900 = 1300");
    });

    it("splits the per-game chance by effective rating, team stays level", async () => {
      const { user } = setup([
        player("p1", "Ann", 1900),
        player("p2", "Bob", 1100),
        player("p3", "Cid", 1500),
        player("p4", "Dee", 1500),
      ]);
      await pickPlayers(user);

      // The pair is exactly as strong as the other pair, so the *team* is a
      // coin flip - but the partner weight leaves Ann and Bob at different
      // effective ratings, so their individual per-game odds differ. That gap
      // is what shows up as their unequal Elo change.
      const [teamA] = screen.getAllByRole("tooltip");
      expect(teamA).toHaveTextContent("(76.0% + 76.0%) ÷ 2 = 76.0%");
      expect(teamA).toHaveTextContent("(24.0% + 24.0%) ÷ 2 = 24.0%");
      expect(teamA).toHaveTextContent("(76.0% + 24.0%) ÷ 2 = 50.0%");
    });

    it("averages each player's chance over the two opponents separately", async () => {
      // Opponents at different ratings, so the two duels behind each player's
      // number actually differ - with a level pair they are identical and a
      // version that measured one opponent twice would pass anyway.
      const { user } = setup([
        player("p1", "Ann", 1900),
        player("p2", "Bob", 1100),
        player("p3", "Cid", 1700),
        player("p4", "Dee", 1300),
      ]);
      await pickPlayers(user);

      const [teamA] = screen.getAllByRole("tooltip");
      // Effective: Ann 1700, Bob 1300 vs Cid 1600, Dee 1400. Ann is +100 on Cid
      // (64.0%) and +300 on Dee (84.9%); Bob is the mirror.
      expect(teamA).toHaveTextContent("(64.0% + 84.9%) ÷ 2 = 74.5%");
      expect(teamA).toHaveTextContent("(15.1% + 36.0%) ÷ 2 = 25.5%");
      expect(teamA).toHaveTextContent("(74.5% + 25.5%) ÷ 2 = 50.0%");
      // Each percentage is rounded on its own, so a line can still be a tenth
      // out - Bob's two terms average to 25.55 while the exact expectation is
      // 25.547. The result is the real number, NOT the mean of the two rounded
      // ones, which is what keeps it equal to the value driving the chips.
      expect(teamA).toHaveTextContent("vs Cid 1600, Dee 1400");
    });
  });

  it("accepts a one-game match without deleting the spare rows", async () => {
    const { user } = setup();
    await pickPlayers(user);

    await user.click(
      within(gameRows()[0]).getByRole("button", { name: /Team B won game 1/ }),
    );
    expect(submitButton()).toBeEnabled();

    await user.click(submitButton());
    expect(recordMatch).toHaveBeenCalledWith("p1", "p2", "p3", "p4", [
      { w: "B", a: null, b: null },
    ]);
  });
});
