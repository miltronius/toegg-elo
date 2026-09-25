import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Leaderboard } from "./Leaderboard";
import type {
  Player,
  EloHistory,
  Season,
  PlayerSeasonStats,
} from "../lib/supabase";

// ── helpers ───────────────────────────────────────────────────────────────────

const player = (
  id: string,
  name: string,
  elo: number,
  wins = 3,
  losses = 1,
): Player => ({
  id,
  name,
  current_elo: elo,
  matches_played: wins + losses,
  wins,
  losses,
  created_at: "2024-01-01T00:00:00Z",
  anonymous_name: null,
});

const PLAYERS: Player[] = [
  player("aaa", "Alice", 1700, 8, 2),
  player("bbb", "Bob", 1500, 5, 5),
  player("ccc", "Carl", 1300, 2, 8),
];
const NO_HISTORY: EloHistory[] = [];

const season = (
  id: string,
  number: number,
  name: string,
  is_active = false,
): Season => ({
  id,
  number,
  name,
  is_active,
  k_factor: 32,
  partner_weight: 0.333,
  inactivity_penalty_percent: 0,
  started_at: "2024-01-01T00:00:00Z",
  ended_at: is_active ? null : "2024-06-01T00:00:00Z",
  created_at: "2024-01-01T00:00:00Z",
});

const pss = (
  player_id: string,
  season_id: string,
  current_season_elo = 1500,
  wins = 0,
  losses = 0,
): PlayerSeasonStats => ({
  id: `${player_id}-${season_id}`,
  player_id,
  season_id,
  elo_at_start: 1500,
  current_season_elo,
  wins,
  losses,
  last_match_at: null,
  created_at: "2024-01-01T00:00:00Z",
});

/** The active season the roster-filter tests run in; ranking only exists there. */
const CURRENT = season("cur", 1, "Current", true);

/** Render `field` as the current season, its season stats mirroring each player. */
const renderSeason = (field: Player[]) =>
  render(
    <Leaderboard
      players={field}
      history={NO_HISTORY}
      seasons={[CURRENT]}
      selectedSeason={CURRENT}
      playerSeasonStats={field.map((p) =>
        pss(p.id, CURRENT.id, p.current_elo, p.wins, p.losses),
      )}
    />,
  );

const RANKED_TITLE = "Ranked - 3+ games this season";

// ── unauthenticated / read-only view ──────────────────────────────────────────

describe("Leaderboard - unauthenticated (no onPlayerClick)", () => {
  it("renders all players", () => {
    render(<Leaderboard players={PLAYERS} history={NO_HISTORY} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Carl")).toBeInTheDocument();
  });

  it("shows Elo values", () => {
    render(<Leaderboard players={PLAYERS} history={NO_HISTORY} />);
    expect(screen.getByText("1700")).toBeInTheDocument();
    expect(screen.getByText("1500")).toBeInTheDocument();
    expect(screen.getByText("1300")).toBeInTheDocument();
  });

  it("shows rank #1 for top player by Elo", () => {
    render(<Leaderboard players={PLAYERS} history={NO_HISTORY} />);
    const rows = screen.getAllByRole("row").slice(1); // skip header
    expect(rows[0]).toHaveTextContent("#1");
    expect(rows[0]).toHaveTextContent("Alice");
  });

  it("shows empty state when there are no players", () => {
    render(<Leaderboard players={[]} history={NO_HISTORY} />);
    expect(screen.getByText(/no players yet/i)).toBeInTheDocument();
  });
});

// ── sorting ───────────────────────────────────────────────────────────────────

describe("Leaderboard - sorting", () => {
  it("sorts by Elo descending by default", () => {
    render(<Leaderboard players={PLAYERS} history={NO_HISTORY} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Alice");
    expect(rows[1]).toHaveTextContent("Bob");
    expect(rows[2]).toHaveTextContent("Carl");
  });

  it("sorts alphabetically A→Z by name when Name header clicked", async () => {
    render(<Leaderboard players={PLAYERS} history={NO_HISTORY} />);
    await userEvent.click(screen.getByText(/^Name/));
    const rows = screen.getAllByRole("row").slice(1);
    const names = rows.map((r) => r.querySelector(".name")?.textContent);
    // First click on new column: sortAsc=false → for name diff=a.localeCompare(b) → A→Z
    expect(names[0]).toBe("Alice");
    expect(names[2]).toBe("Carl");
  });

  it("reverses sort order on second click of same column", async () => {
    render(<Leaderboard players={PLAYERS} history={NO_HISTORY} />);
    // Use role+name to target the th header, not the "Elo Chart" toggle button
    const eloHeader = screen.getByRole("columnheader", { name: /ELO/ });
    // First click: same column (elo), toggles to asc
    await userEvent.click(eloHeader);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Carl"); // lowest Elo first
    expect(rows[2]).toHaveTextContent("Alice");
  });

  it("breaks Elo ties by winrate descending", () => {
    const tied = [
      player("aaa", "Alice", 1600, 8, 2), // 80% winrate
      player("bbb", "Bob", 1600, 5, 5), // 50% winrate
      player("ccc", "Carl", 1300, 2, 8),
    ];
    render(<Leaderboard players={tied} history={NO_HISTORY} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Alice"); // same Elo, higher winrate → #1
    expect(rows[1]).toHaveTextContent("Bob");
    expect(rows[0]).toHaveTextContent("#1");
    expect(rows[1]).toHaveTextContent("#2");
  });

  it("rank column always reflects ELO position regardless of sort", async () => {
    render(<Leaderboard players={PLAYERS} history={NO_HISTORY} />);
    // Click Name twice: first click = A→Z, second click = Z→A (Carl first)
    const nameHeader = screen.getByRole("columnheader", { name: /Name/ });
    await userEvent.click(nameHeader); // A→Z
    await userEvent.click(nameHeader); // Z→A
    const rows = screen.getAllByRole("row").slice(1);
    // Carl should appear first alphabetically desc, but his ELO rank should be #3
    expect(rows[0]).toHaveTextContent("Carl");
    expect(rows[0]).toHaveTextContent("#3");
  });
});

// ── canEdit (onPlayerClick provided) ─────────────────────────────────────────

describe("Leaderboard - with onPlayerClick (edit-capable user)", () => {
  it("calls onPlayerClick when a row is clicked", async () => {
    const onPlayerClick = vi.fn();
    render(
      <Leaderboard
        players={PLAYERS}
        history={NO_HISTORY}
        onPlayerClick={onPlayerClick}
      />,
    );
    await userEvent.click(screen.getByText("Alice"));
    expect(onPlayerClick).toHaveBeenCalledWith(PLAYERS[0]);
  });

  it("does not throw when rows clicked without onPlayerClick", async () => {
    render(<Leaderboard players={PLAYERS} history={NO_HISTORY} />);
    // Should not throw - onPlayerClick is optional
    await userEvent.click(screen.getByText("Bob"));
  });
});

// ── winrate display ───────────────────────────────────────────────────────────

describe("Leaderboard - winrate", () => {
  it("shows winrate percentage", () => {
    render(<Leaderboard players={PLAYERS} history={NO_HISTORY} />);
    // Alice: 8W 2L = 80.0%
    expect(screen.getByText("80.0%")).toBeInTheDocument();
    // Bob: 5W 5L = 50.0%
    expect(screen.getByText("50.0%")).toBeInTheDocument();
  });

  it("shows a player with no matches when no narrower view is available", () => {
    const newbie = player("zzz", "Newbie", 1500, 0, 0);
    render(<Leaderboard players={[newbie]} history={NO_HISTORY} />);
    // Nobody has played, so "Played" has nothing to show → default is "All".
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("hides players with no matches from a season's first match onwards", () => {
    // One 2v2 game = 4 players with a game, which is enough to select Played.
    const field = [
      ...Array.from({ length: 4 }, (_, i) =>
        player(`p${i}`, `P${i}`, 1500 + i, 1, 0),
      ),
      player("zzz", "Newbie", 1400, 0, 0),
    ];
    renderSeason(field);
    expect(screen.getByText("P0")).toBeInTheDocument();
    expect(screen.queryByText("Newbie")).not.toBeInTheDocument();
  });
});

// ── roster filter (All / Played / Ranked) ─────────────────────────────────────

describe("Leaderboard - roster filter", () => {
  // 4 players: neither narrowing view reaches 5 → default is "All".
  const SMALL = [
    player("aaa", "Alice", 1700, 8, 2),
    player("bbb", "Bob", 1600, 2, 0), // 2 games - played but unranked
    player("ccc", "Carl", 1550, 1, 0), // 1 game - played but unranked
    player("ddd", "Dana", 1500, 0, 0), // never played
  ];

  const seg = (name: string) => screen.getByRole("button", { name });
  const rowOf = (name: string) => screen.getByText(name).closest("tr")!;

  it("defaults to All when no narrower view has enough entries", () => {
    renderSeason(SMALL);
    expect(seg("All")).toHaveClass("active");
    expect(screen.getByText("Dana")).toBeInTheDocument();
  });

  it("shows only players with 3+ games under Ranked", () => {
    renderSeason(SMALL);
    fireEvent.click(seg("Ranked"));
    expect(screen.getByText("Alice")).toBeInTheDocument(); // 10 games
    expect(screen.queryByText("Bob")).not.toBeInTheDocument(); // 2 games
    expect(screen.queryByText("Carl")).not.toBeInTheDocument(); // 1 game
    expect(screen.queryByText("Dana")).not.toBeInTheDocument();
  });

  it("drops never-played players under Played", () => {
    renderSeason(SMALL);
    fireEvent.click(seg("Played"));
    expect(screen.getByText("Carl")).toBeInTheDocument();
    expect(screen.queryByText("Dana")).not.toBeInTheDocument();
  });

  it("ranks over the visible players only", () => {
    renderSeason(SMALL);
    fireEvent.click(seg("Ranked"));
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("#1");
    expect(rows[0]).toHaveTextContent("Alice");
  });

  it("defaults to Ranked once 4 players qualify", () => {
    const field = [
      player("a", "Ann", 1700, 3, 1),
      player("b", "Ben", 1650, 3, 1),
      player("c", "Cid", 1600, 3, 1),
      player("d", "Dee", 1550, 3, 1),
      player("f", "Fay", 1450, 1, 0), // 1 game - excluded by the default
    ];
    renderSeason(field);
    expect(seg("Ranked")).toHaveClass("active");
    expect(screen.getByText("Ann")).toBeInTheDocument();
    expect(screen.queryByText("Fay")).not.toBeInTheDocument();
  });

  it("holds off on Ranked at 3 qualifiers", () => {
    const field = [
      player("a", "Ann", 1700, 3, 1),
      player("b", "Ben", 1650, 3, 1),
      player("c", "Cid", 1600, 3, 1),
      player("f", "Fay", 1450, 1, 0),
    ];
    renderSeason(field);
    expect(seg("Played")).toHaveClass("active");
    expect(seg("Ranked")).toBeEnabled();
    expect(screen.getByText("Fay")).toBeInTheDocument();
  });

  it("never defaults to Ranked while it would show nobody", () => {
    const field = Array.from({ length: 10 }, (_, i) =>
      player(`p${i}`, `P${i}`, 1500 + i, 1, 0),
    );
    renderSeason(field);
    expect(seg("Played")).toHaveClass("active");
    expect(screen.getByText("P0")).toBeInTheDocument();
  });

  it("disables Ranked while nobody qualifies", () => {
    const field = Array.from({ length: 10 }, (_, i) =>
      player(`p${i}`, `P${i}`, 1500 + i, 1, 0),
    );
    renderSeason(field);
    expect(seg("Ranked")).toBeDisabled();
    expect(seg("Played")).toBeEnabled();
  });

  it("disables Played while nobody has played", () => {
    const field = Array.from({ length: 6 }, (_, i) =>
      player(`p${i}`, `P${i}`, 1500, 0, 0),
    );
    renderSeason(field);
    expect(seg("Played")).toBeDisabled();
    expect(seg("Ranked")).toBeDisabled();
    expect(seg("All")).toBeEnabled();
    expect(seg("All")).toHaveClass("active");
  });

  it("enables Ranked as soon as one player qualifies", () => {
    const field = [
      player("a", "Ann", 1700, 3, 0),
      ...Array.from({ length: 5 }, (_, i) =>
        player(`p${i}`, `P${i}`, 1500, 1, 0),
      ),
    ];
    renderSeason(field);
    // Only one qualifier - offered, but not auto-selected.
    expect(seg("Ranked")).toBeEnabled();
    expect(seg("Played")).toHaveClass("active");
  });

  it("marks ranked players under All and Played", () => {
    renderSeason(SMALL);
    // Alice has 10 games this season; Bob, Carl and Dana are short of 3.
    expect(screen.getAllByTitle(RANKED_TITLE)).toHaveLength(1);
    expect(rowOf("Alice")).toContainElement(screen.getByTitle(RANKED_TITLE));
    fireEvent.click(seg("Played"));
    expect(screen.getAllByTitle(RANKED_TITLE)).toHaveLength(1);
  });

  it("keeps the badges in their own column before the name, so they align", () => {
    renderSeason(SMALL);
    const header = screen.getAllByRole("columnheader");
    expect(header).toHaveLength(5);
    expect(header[1]).toHaveAccessibleName(RANKED_TITLE);
    // Every row has the cell, badge or not; the name is always the next one.
    for (const name of ["Alice", "Bob", "Dana"]) {
      const cells = rowOf(name).querySelectorAll("td");
      expect(cells[1]).toHaveClass("ranked-col");
      expect(cells[2]).toHaveTextContent(name);
    }
    expect(rowOf("Alice").querySelectorAll("td")[1]).toContainElement(
      screen.getByTitle(RANKED_TITLE),
    );
  });

  it("drops the badge under Ranked, where every row would carry it", () => {
    renderSeason(SMALL);
    fireEvent.click(seg("Ranked"));
    expect(screen.queryByTitle(RANKED_TITLE)).not.toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
  });
});

describe("Leaderboard - all-time roster filter", () => {
  const seg = (name: string) => screen.queryByRole("button", { name });
  const QUALIFIED = [
    player("a", "Ann", 1700, 3, 1),
    player("b", "Ben", 1650, 3, 1),
    player("c", "Cid", 1600, 3, 1),
    player("d", "Dee", 1550, 3, 1),
    player("f", "Fay", 1450, 1, 0),
  ];

  it("locks the roster toggle on All, so the header holds still", () => {
    const idle = player("z", "Zed", 1500, 0, 0);
    render(<Leaderboard players={[...QUALIFIED, idle]} history={NO_HISTORY} />);
    for (const name of ["All", "Played", "Ranked"])
      expect(seg(name)).toBeDisabled();
    // 4 players with 3+ games would pick Ranked in a season; here it's All.
    expect(seg("All")).toHaveClass("active");
    expect(seg("Ranked")).toHaveAttribute(
      "title",
      "Only for a single season - all-time shows everyone",
    );
    expect(screen.getByText("Zed")).toBeInTheDocument();
  });

  it("shows no ranked badge", () => {
    render(<Leaderboard players={QUALIFIED} history={NO_HISTORY} />);
    expect(screen.queryByTitle(RANKED_TITLE)).not.toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
  });
});

describe("Leaderboard - streak column", () => {
  const row = (
    player_id: string,
    match_id: string,
    won: boolean,
    created_at: string,
  ): EloHistory => ({
    id: `${player_id}-${match_id}`,
    player_id,
    match_id,
    season_id: "s1",
    elo_before: 1500,
    elo_after: won ? 1510 : 1490,
    elo_change: won ? 10 : -10,
    won,
    created_at,
  });
  const at = (day: number) => `2024-01-0${day}T00:00:00Z`;
  const cellsOf = (name: string) =>
    screen.getByText(name).closest("tr")!.querySelectorAll("td");

  it("puts win and lose streaks in one column before the name", () => {
    const history = [
      row("aaa", "m1", true, at(1)),
      row("aaa", "m2", true, at(2)),
      row("ccc", "m1", false, at(1)),
      row("ccc", "m2", false, at(2)),
      row("ccc", "m3", false, at(3)),
    ];
    render(<Leaderboard players={PLAYERS} history={history} />);
    expect(screen.getAllByRole("columnheader")[1]).toHaveAccessibleName(
      "Current streak",
    );
    // Alice 🔥2, Bob nothing, Carl 🥶3 - same column, name always next.
    const [alice, bob, carl] = ["Alice", "Bob", "Carl"].map(cellsOf);
    expect(alice[1]).toHaveTextContent("🔥2");
    expect(bob[1]).toBeEmptyDOMElement();
    expect(carl[1]).toHaveTextContent("🥶3");
    for (const [cells, name] of [
      [alice, "Alice"],
      [bob, "Bob"],
      [carl, "Carl"],
    ] as const)
      expect(cells[2]).toHaveTextContent(new RegExp(`^${name}$`));
  });

  it("drops the column while nobody is on a streak", () => {
    render(<Leaderboard players={PLAYERS} history={NO_HISTORY} />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
  });
});

// ── season view: exclude players who didn't exist that season ──────────────────

describe("Leaderboard - season view participation", () => {
  const eh = (
    player_id: string,
    season_id: string,
    match_id: string,
    elo_before: number,
    elo_after: number,
    created_at: string,
  ): EloHistory => ({
    id: `${player_id}-${match_id}`,
    player_id,
    match_id,
    season_id,
    elo_before,
    elo_after,
    elo_change: elo_after - elo_before,
    won: elo_after > elo_before,
    created_at,
  });

  const S1 = season("s1", 1, "Spring");
  const S2 = season("s2", 2, "Summer", true);
  // Veteran played in S1; Latecomer first appears in S2. Both have all-time matches.
  const VETERAN = player("vvv", "Veteran", 1700, 8, 2);
  const LATECOMER = player("lll", "Latecomer", 1600, 3, 1);
  const HISTORY: EloHistory[] = [
    eh("vvv", "s1", "m1", 1500, 1520, "2024-02-01T00:00:00Z"),
    eh("lll", "s2", "m2", 1500, 1530, "2024-07-01T00:00:00Z"),
  ];

  it("excludes a player who has no history in the selected older season", () => {
    render(
      <Leaderboard
        players={[VETERAN, LATECOMER]}
        history={HISTORY}
        seasons={[S2, S1]}
        selectedSeason={S1}
      />,
    );
    expect(screen.getByText("Veteran")).toBeInTheDocument();
    expect(screen.queryByText("Latecomer")).not.toBeInTheDocument();
  });

  it("includes a player only in the season where they actually played", () => {
    render(
      <Leaderboard
        players={[VETERAN, LATECOMER]}
        history={HISTORY}
        seasons={[S2, S1]}
        selectedSeason={S2}
      />,
    );
    expect(screen.getByText("Latecomer")).toBeInTheDocument();
    expect(screen.queryByText("Veteran")).not.toBeInTheDocument();
  });

  it("shows all players with matches in all-time view", () => {
    render(
      <Leaderboard
        players={[VETERAN, LATECOMER]}
        history={HISTORY}
        seasons={[S2, S1]}
        selectedSeason={null}
      />,
    );
    expect(screen.getByText("Veteran")).toBeInTheDocument();
    expect(screen.getByText("Latecomer")).toBeInTheDocument();
  });

  it("shows the full season roster (incl. zero-match players) under All", () => {
    // Freshly created S2: every current player has a stats row but no matches yet.
    render(
      <Leaderboard
        players={[VETERAN, LATECOMER]}
        history={[]}
        seasons={[S2, S1]}
        selectedSeason={S2}
        playerSeasonStats={[pss("vvv", "s2"), pss("lll", "s2")]}
      />,
    );
    // Nobody has played the new season, so Played has nothing to offer and the
    // default lands on All → the whole roster shows (all at starting ELO).
    expect(screen.getByRole("button", { name: "Played" })).toBeDisabled();
    expect(screen.getByText("Veteran")).toBeInTheDocument();
    expect(screen.getByText("Latecomer")).toBeInTheDocument();
  });

  it("still excludes a later-season newcomer from an older season even under All", () => {
    // S1 roster only had Veteran; Latecomer joined for S2.
    render(
      <Leaderboard
        players={[VETERAN, LATECOMER]}
        history={HISTORY}
        seasons={[S2, S1]}
        selectedSeason={S1}
        playerSeasonStats={[pss("vvv", "s1", 1520, 1, 0)]}
      />,
    );
    fireEvent.click(screen.getByText("All"));
    expect(screen.getByText("Veteran")).toBeInTheDocument();
    expect(screen.queryByText("Latecomer")).not.toBeInTheDocument();
  });

  it("hands the canonical all-time player to onPlayerClick, not season-overridden stats", async () => {
    const onPlayerClick = vi.fn();
    render(
      <Leaderboard
        players={[VETERAN]}
        history={[eh("vvv", "s1", "m1", 1500, 1520, "2024-02-01T00:00:00Z")]}
        seasons={[S2, S1]}
        selectedSeason={S1}
        playerSeasonStats={[pss("vvv", "s1", 1520, 1, 0)]}
        onPlayerClick={onPlayerClick}
      />,
    );
    // The table shows Veteran's S1 numbers (ELO 1520, 1-0), but PlayerDetail must
    // receive the all-time player so its All-Time view isn't polluted with them.
    await userEvent.click(screen.getByText("Veteran"));
    expect(onPlayerClick).toHaveBeenCalledTimes(1);
    const clicked = onPlayerClick.mock.calls[0][0];
    expect(clicked.current_elo).toBe(1700);
    expect(clicked.wins).toBe(8);
    expect(clicked.losses).toBe(2);
  });
});
