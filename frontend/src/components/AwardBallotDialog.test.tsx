import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AwardBallotDialog } from "./AwardBallotDialog";
import type { Player, PlayerSeasonStats, Season } from "../lib/supabase";
import type { AwardId, AwardVote } from "../lib/seasonAwards";

// You are Anna (p1).
const me = vi.hoisted(() => ({
  role: "user" as string | null,
  myPlayerId: "p1" as string | null,
  refreshMyPlayer: async () => {},
}));
vi.mock("../contexts/AuthContext", () => ({ useMe: () => me }));

const DAY = 86_400_000;
const T0 = Date.parse("2026-10-01T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const season = (id: string, number: number, over: Partial<Season> = {}): Season => ({
  id,
  number,
  name: `Season ${number}`,
  k_factor: 48,
  partner_weight: 0.25,
  inactivity_penalty_percent: 0,
  started_at: iso(T0 - 120 * DAY),
  ended_at: null,
  is_active: false,
  created_at: iso(T0 - 120 * DAY),
  planned_end_at: null,
  voting_opened_at: null,
  ...over,
});
const S4 = season("s4", 4, { ended_at: iso(T0 - 60 * DAY) });
const S5 = season("s5", 5, { started_at: iso(T0 - 60 * DAY), is_active: true, voting_opened_at: iso(T0) });
const player = (id: string, name: string): Player => ({
  id,
  name,
  current_elo: 1500,
  matches_played: 0,
  wins: 0,
  losses: 0,
  created_at: iso(T0),
  anonymous_name: null,
  is_linked: false,
});
const PLAYERS = [
  player("p1", "Anna"),
  player("p2", "Ben"),
  player("p3", "Carla"),
  player("p4", "Dario"),
  player("p5", "Emil"),
];
const stat = (player_id: string, season_id: string, games: number): PlayerSeasonStats => ({
  id: `${player_id}-${season_id}`,
  player_id,
  season_id,
  elo_at_start: 1500,
  current_season_elo: 1500,
  wins: games,
  losses: 0,
  last_match_at: null,
  created_at: iso(T0),
});
// Anna (you) and Ben are ranked for the first time, Dario for the second;
// Carla played once; Emil not at all.
const STATS = [
  stat("p1", "s5", 3),
  stat("p2", "s5", 3),
  stat("p3", "s5", 1),
  stat("p4", "s5", 4),
  stat("p4", "s4", 3),
];
const vote = (award_id: AwardId, nominee_player_id: string): AwardVote => ({
  season_id: "s5",
  award_id,
  voter_user_id: "u1",
  nominee_player_id,
  updated_at: iso(T0),
});

function setup(over: Partial<React.ComponentProps<typeof AwardBallotDialog>> = {}) {
  const onCast = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <AwardBallotDialog
      season={S5}
      seasons={[S5, S4]}
      players={PLAYERS}
      seasonStats={STATS}
      votes={[]}
      onCast={onCast}
      onClose={onClose}
      {...over}
    />,
  );
  return { onCast, onClose, user: userEvent.setup() };
}
const award = (name: RegExp) => screen.getByRole("group", { name });
const nomineeNames = (group: HTMLElement) =>
  within(group)
    .queryAllByRole("button")
    .map((b) => b.querySelector(".nominee-name")?.textContent);
const card = (group: HTMLElement, name: string) =>
  within(group).getByRole("button", { name: new RegExp(`^${name}`) });

describe("AwardBallotDialog", () => {
  it("has one card group per award", () => {
    setup();
    expect(screen.getAllByRole("group")).toHaveLength(6);
  });

  it("offers only eligible nominees as cards, never yourself", () => {
    setup();
    expect(nomineeNames(award(/Best Offensive Player/))).toEqual(["Ben", "Dario"]);
  });

  it("limits the rookie award to first-time ranked players", () => {
    setup();
    expect(nomineeNames(award(/Rookie of the Season/))).toEqual(["Ben"]);
  });

  it("leaves out players too new to be ranked", () => {
    setup();
    expect(screen.queryByRole("button", { name: /^Carla/ })).toBeNull();
  });

  it("shows each nominee's season Elo and games", () => {
    setup();
    expect(card(award(/Best Offensive Player/), "Ben")).toHaveTextContent("1500 Elo · 3 games");
    expect(card(award(/Best Offensive Player/), "Dario")).toHaveTextContent("1500 Elo · 4 games");
  });

  it("saves a pick as soon as a card is clicked", async () => {
    const { user, onCast } = setup();
    const ben = card(award(/Best Offensive Player/), "Ben");
    await user.click(ben);
    expect(onCast).toHaveBeenCalledWith("award_offense", "p2");
    expect(ben).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("1/6 picked")).toBeInTheDocument();
  });

  it("clears a pick when its card is clicked again", async () => {
    const { user, onCast } = setup({ votes: [vote("award_offense", "p2")] });
    const ben = card(award(/Best Offensive Player/), "Ben");
    expect(ben).toHaveAttribute("aria-pressed", "true");
    await user.click(ben);
    expect(onCast).toHaveBeenCalledWith("award_offense", null);
    expect(ben).toHaveAttribute("aria-pressed", "false");
  });

  it("puts a refused pick back and says why", async () => {
    const onCast = vi.fn().mockRejectedValue({ message: "voting_not_open" });
    const { user } = setup({ onCast });
    await user.click(card(award(/Best Offensive Player/), "Ben"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Voting isn't open for this season."),
    );
    expect(card(award(/Best Offensive Player/), "Ben")).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps a pick who no longer qualifies visible, with a warning", () => {
    // Dario was ranked in S4 too, so he's no rookie.
    setup({ votes: [vote("award_rookie", "p4")] });
    const dario = card(award(/Rookie of the Season/), "Dario");
    expect(dario).toHaveAttribute("aria-pressed", "true");
    expect(dario).toHaveClass("is-stale");
    expect(
      screen.getByText(/Dario doesn't qualify for this award right now/),
    ).toBeInTheDocument();
  });

  it("says so when nobody qualifies for an award yet", () => {
    // Ben is the only rookie besides you.
    setup({ seasonStats: STATS.filter((s) => s.player_id !== "p2") });
    const rookie = award(/Rookie of the Season/);
    expect(nomineeNames(rookie)).toEqual([]);
    expect(within(rookie).getByText("Nobody is eligible yet.")).toBeInTheDocument();
  });

  it("closes on Done", async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
