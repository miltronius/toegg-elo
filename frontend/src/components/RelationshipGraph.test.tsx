import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RelationshipGraph } from "./RelationshipGraph";
import type { Match, Player, Season } from "../lib/supabase";

// ── helpers ──────────────────────────────────────────────────────────────────

const player = (id: string, name: string, elo = 1500): Player => ({
  id,
  name,
  current_elo: elo,
  matches_played: 0,
  wins: 0,
  losses: 0,
  created_at: "2024-01-01T00:00:00Z",
  anonymous_name: null,
});

let mc = 0;
const match = (o: Partial<Match> = {}): Match => {
  const winning_team = o.winning_team ?? "A";
  return {
    id: `m${++mc}`,
    team_a_player_1_id: "p1",
    team_a_player_2_id: "p2",
    team_b_player_1_id: "p3",
    team_b_player_2_id: "p4",
    winning_team,
    // Legacy shape: a 1-0 series with no per-game detail.
    team_a_games: winning_team === "A" ? 1 : 0,
    team_b_games: winning_team === "B" ? 1 : 0,
    games: null,
    season_id: "s1",
    created_at: "2024-01-15T10:00:00Z",
    ...o,
  };
};

const PLAYERS = [
  player("p1", "Ann"),
  player("p2", "Bob"),
  player("p3", "Cid"),
  player("p4", "Dee"),
];

const SEASONS: Season[] = [
  {
    id: "s1",
    number: 1,
    name: "First",
    k_factor: 32,
    partner_weight: 0.333,    inactivity_penalty_percent: 0,
    started_at: "2024-01-01T00:00:00Z",
    ended_at: null,
    is_active: true,
    created_at: "2024-01-01T00:00:00Z",
  },
];

function setup(
  props: Partial<React.ComponentProps<typeof RelationshipGraph>> = {},
) {
  const onPlayerClick = vi.fn();
  render(
    <RelationshipGraph
      matches={[match()]}
      players={PLAYERS}
      seasons={SEASONS}
      onPlayerClick={onPlayerClick}
      {...props}
    />,
  );
  return { onPlayerClick };
}

// The graph paints its seeded layout on mount rather than waiting for d3's first
// rAF tick, so these assertions don't depend on simulation timing. Positions are
// deliberately never asserted.
const circles = (): SVGCircleElement[] =>
  Array.from(document.querySelectorAll(".relgraph-node"));
// The outer <g> carries the zoom transform; the edge and node groups sit inside it.
const drawnGroups = () =>
  Array.from(document.querySelectorAll(".relgraph-svg > g > g")).length;

// ── rendering ────────────────────────────────────────────────────────────────

describe("RelationshipGraph", () => {
  it("draws a node per player who played", () => {
    setup();

    expect(circles()).toHaveLength(4);
    for (const name of ["Ann", "Bob", "Cid", "Dee"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("leaves out players with no matches", () => {
    setup({ players: [...PLAYERS, player("p9", "Ghost")] });

    expect(screen.queryByText("Ghost")).not.toBeInTheDocument();
    expect(circles()).toHaveLength(4);
  });

  it("shows an empty state when nothing has been played", () => {
    setup({ matches: [] });

    expect(
      screen.getByText(/no matches in this season yet/i),
    ).toBeInTheDocument();
    expect(circles()).toHaveLength(0);
  });

  it("defaults to all-time rather than the active season", () => {
    setup();

    // "All-Time" is the selected option, not "S1 · First".
    expect(screen.getByRole("combobox")).toHaveValue("all");
  });
});

// ── friends / foes toggle ────────────────────────────────────────────────────

describe("RelationshipGraph - friends/foes toggle", () => {
  it("starts on friends", () => {
    setup();

    expect(screen.getByRole("button", { name: "Friends" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Foes" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("switches to foes on click", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Foes" }));

    expect(screen.getByRole("button", { name: "Foes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Friends" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("swaps the edge set: one match yields 2 partnerships but 4 rivalries", async () => {
    setup();
    // 4 node groups + 2 friend edge groups.
    expect(drawnGroups()).toBe(6);

    await userEvent.click(screen.getByRole("button", { name: "Foes" }));
    // 4 node groups + 4 foe edge groups.
    expect(drawnGroups()).toBe(8);
  });

  it("describes the active lens in the hint", async () => {
    setup();
    expect(screen.getByText(/strongest partnerships/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Foes" }));
    expect(screen.getByText(/biggest rivalries/i)).toBeInTheDocument();
  });
});

// ── 2D / 3D ──────────────────────────────────────────────────────────────────

describe("RelationshipGraph - 3D", () => {
  it("starts in 3D", () => {
    setup();

    expect(screen.getByRole("button", { name: "3D" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "2D" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("seeds nodes off the z=0 plane, so the layout has volume to work with", () => {
    // The whole 3D mode hinges on this: with every node at z=0 the repulsion
    // between them has no z-component and the graph can never leave the plane.
    // The seeded sphere shows up as circles at differing projected radii.
    setup();
    const radii = new Set(circles().map((c) => c.getAttribute("r")));

    expect(radii.size).toBeGreaterThan(1);
  });

  it("flattens back to a single plane in 2D", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "2D" }));

    // No perspective divide in 2D, so equally-played nodes share a radius.
    const radii = new Set(circles().map((c) => c.getAttribute("r")));
    expect(radii.size).toBe(1);
  });

  it("resizes labels from the slider", () => {
    setup();
    const label = () => document.querySelector(".relgraph-label");
    const before = label()?.getAttribute("font-size");

    fireEvent.change(screen.getByLabelText(/label size/i), {
      target: { value: "24" },
    });

    expect(before).not.toBe("24");
    expect(label()).toHaveAttribute("font-size", "24");
  });

  it("keeps every player when switching dimension", async () => {
    setup();
    expect(circles()).toHaveLength(4);

    await userEvent.click(screen.getByRole("button", { name: "2D" }));
    expect(circles()).toHaveLength(4);

    await userEvent.click(screen.getByRole("button", { name: "3D" }));
    expect(circles()).toHaveLength(4);
  });
});

// ── interaction ──────────────────────────────────────────────────────────────

describe("RelationshipGraph - interaction", () => {
  it("opens the player on a click that did not drag", async () => {
    const { onPlayerClick } = setup();
    await userEvent.click(circles()[0]);

    expect(onPlayerClick).toHaveBeenCalledTimes(1);
    // Must hand over the all-time player object so PlayerDetail isn't polluted
    // with season-scoped numbers.
    expect(PLAYERS).toContain(onPlayerClick.mock.calls[0][0]);
  });

  it("thins the edges but keeps the nodes when the budget is lowered", async () => {
    // p1 partners p2 twice and p3 once, so a budget of 1 drops the weaker pairing.
    setup({
      matches: [
        match(),
        match(),
        match({
          team_a_player_1_id: "p1",
          team_a_player_2_id: "p3",
          team_b_player_1_id: "p2",
          team_b_player_2_id: "p4",
        }),
      ],
    });
    const before = drawnGroups();

    fireEvent.change(screen.getByLabelText(/top partners/i), {
      target: { value: "1" },
    });

    expect(drawnGroups()).toBeLessThan(before);
    // The budget only ever removes lines, never players.
    expect(circles()).toHaveLength(4);
  });
});
