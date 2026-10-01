import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
const picker = (name: RegExp) => screen.getByRole("combobox", { name });
const optionNames = () =>
  screen
    .getAllByRole("option")
    .map((o) => o.querySelector(".player-ac-name")?.textContent ?? o.textContent);

describe("AwardBallotDialog", () => {
  it("has one picker per award", () => {
    setup();
    expect(screen.getAllByRole("combobox")).toHaveLength(7);
  });

  it("offers only eligible nominees, never yourself", async () => {
    const { user } = setup();
    await user.click(picker(/Best Offensive Player/));
    expect(optionNames()).toEqual(["No pick", "Ben", "Dario"]);
  });

  it("limits the rookie and guest awards to their nominees", async () => {
    const { user } = setup();
    await user.click(picker(/Rookie of the Season/));
    expect(optionNames()).toEqual(["No pick", "Ben"]);
    await user.keyboard("{Escape}");
    await user.click(picker(/Special Guest/));
    expect(optionNames()).toEqual(["No pick", "Carla"]);
  });

  it("saves a pick as soon as it's made", async () => {
    const { user, onCast } = setup();
    await user.click(picker(/Best Offensive Player/));
    await user.click(screen.getByRole("option", { name: /Ben/ }));
    expect(onCast).toHaveBeenCalledWith("award_offense", "p2");
    expect(screen.getByText("1/7 picked")).toBeInTheDocument();
  });

  it("clears a pick with No pick", async () => {
    const { user, onCast } = setup({ votes: [vote("award_offense", "p2")] });
    expect(picker(/Best Offensive Player/)).toHaveValue("Ben");
    await user.click(picker(/Best Offensive Player/));
    await user.click(screen.getByRole("option", { name: "No pick" }));
    expect(onCast).toHaveBeenCalledWith("award_offense", null);
  });

  it("puts a refused pick back and says why", async () => {
    const onCast = vi.fn().mockRejectedValue({ message: "voting_not_open" });
    const { user } = setup({ onCast });
    await user.click(picker(/Best Offensive Player/));
    await user.click(screen.getByRole("option", { name: /Ben/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Voting isn't open for this season."),
    );
    expect(picker(/Best Offensive Player/)).toHaveValue("");
  });

  it("keeps a pick who no longer qualifies visible, with a warning", () => {
    setup({ votes: [vote("award_guest", "p4")] });
    expect(picker(/Special Guest/)).toHaveValue("Dario");
    expect(
      screen.getByText(/Dario doesn't qualify for this award right now/),
    ).toBeInTheDocument();
  });

  it("disables an award nobody qualifies for yet", () => {
    setup({ seasonStats: STATS.filter((s) => s.player_id !== "p3") });
    expect(picker(/Special Guest/)).toBeDisabled();
    expect(picker(/Special Guest/)).toHaveAttribute("placeholder", "Nobody is eligible yet.");
  });

  it("closes on Done", async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
