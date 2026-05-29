import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Leaderboard } from "./Leaderboard";
import type { Player, EloHistory, Season } from "../lib/supabase";

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
});

const PLAYERS: Player[] = [
  player("aaa", "Alice", 1700, 8, 2),
  player("bbb", "Bob", 1500, 5, 5),
  player("ccc", "Carl", 1300, 2, 8),
];
const NO_HISTORY: EloHistory[] = [];

// ── unauthenticated / read-only view ──────────────────────────────────────────

describe("Leaderboard — unauthenticated (no onPlayerClick)", () => {
  it("renders all players", () => {
    render(
      <Leaderboard players={PLAYERS} history={NO_HISTORY} />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Carl")).toBeInTheDocument();
  });

  it("shows ELO values", () => {
    render(<Leaderboard players={PLAYERS} history={NO_HISTORY} />);
    expect(screen.getByText("1700")).toBeInTheDocument();
    expect(screen.getByText("1500")).toBeInTheDocument();
    expect(screen.getByText("1300")).toBeInTheDocument();
  });

  it("shows rank #1 for top player by ELO", () => {
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

describe("Leaderboard — sorting", () => {
  it("sorts by ELO descending by default", () => {
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
    // Use role+name to target the th header, not the "ELO Chart" toggle button
    const eloHeader = screen.getByRole("columnheader", { name: /ELO/ });
    // First click: same column (elo), toggles to asc
    await userEvent.click(eloHeader);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Carl"); // lowest ELO first
    expect(rows[2]).toHaveTextContent("Alice");
  });

  it("breaks ELO ties by winrate descending", () => {
    const tied = [
      player("aaa", "Alice", 1600, 8, 2), // 80% winrate
      player("bbb", "Bob",   1600, 5, 5), // 50% winrate
      player("ccc", "Carl",  1300, 2, 8),
    ];
    render(<Leaderboard players={tied} history={NO_HISTORY} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Alice"); // same ELO, higher winrate → #1
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

describe("Leaderboard — with onPlayerClick (edit-capable user)", () => {
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
    // Should not throw — onPlayerClick is optional
    await userEvent.click(screen.getByText("Bob"));
  });
});

// ── winrate display ───────────────────────────────────────────────────────────

describe("Leaderboard — winrate", () => {
  it("shows winrate percentage", () => {
    render(<Leaderboard players={PLAYERS} history={NO_HISTORY} />);
    // Alice: 8W 2L = 80.0%
    expect(screen.getByText("80.0%")).toBeInTheDocument();
    // Bob: 5W 5L = 50.0%
    expect(screen.getByText("50.0%")).toBeInTheDocument();
  });

  it("hides players with no matches by default, shows them when toggled", () => {
    const newbie = player("zzz", "Newbie", 1500, 0, 0);
    render(<Leaderboard players={[newbie]} history={NO_HISTORY} />);
    // filtered out by default (Active only = on)
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    // toggle off Active only → newbie appears
    fireEvent.click(screen.getByText("Active only"));
    expect(screen.getByText("0%")).toBeInTheDocument();
  });
});

// ── season view: exclude players who didn't exist that season ──────────────────

describe("Leaderboard — season view participation", () => {
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
    inactivity_penalty_percent: 0,
    started_at: "2024-01-01T00:00:00Z",
    ended_at: is_active ? null : "2024-06-01T00:00:00Z",
    created_at: "2024-01-01T00:00:00Z",
  });

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
});

