import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AwardVoteNudge } from "./AwardVoteNudge";
import type { PlayerSeasonStats, Season } from "../lib/supabase";
import type { AwardId, AwardVote } from "../lib/seasonAwards";

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

const DAY = 86_400_000;
const T0 = Date.parse("2026-10-01T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const season = (over: Partial<Season>): Season => ({
  id: "s5",
  number: 5,
  name: "Autumn",
  k_factor: 48,
  partner_weight: 0.25,
  inactivity_penalty_percent: 0,
  started_at: iso(T0 - 60 * DAY),
  ended_at: null,
  is_active: true,
  created_at: iso(T0 - 60 * DAY),
  planned_end_at: null,
  voting_opened_at: null,
  ...over,
});
// S4 ended at T0, when S5 started: S4's ballot is open until T0 + 14 days.
const S4 = season({ id: "s4", number: 4, name: "Summer", is_active: false, ended_at: iso(T0) });
const S5 = season({ started_at: iso(T0) });
const vote = (award_id: AwardId): AwardVote => ({
  season_id: "s4",
  award_id,
  voter_user_id: "u1",
  nominee_player_id: "p2",
  updated_at: iso(T0),
});

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
// You are p1; p2 is a first-time ranked player in both seasons' terms, so
// every award has someone to vote for.
const STATS = [stat("p1", "s4", 3), stat("p2", "s4", 3), stat("p1", "s5", 3), stat("p2", "s5", 3)];

function renderNudge(over: Partial<React.ComponentProps<typeof AwardVoteNudge>> = {}) {
  const onOpenBallot = vi.fn();
  const view = render(
    <AwardVoteNudge
      seasons={[S5, S4]}
      votes={[vote("award_fun"), vote("award_rookie")]}
      seasonStats={STATS}
      onOpenBallot={onOpenBallot}
      now={T0 + DAY}
      {...over}
    />,
  );
  return { onOpenBallot, ...view };
}

describe("AwardVoteNudge", () => {
  it("invites a linked player to vote, with progress and the deadline", async () => {
    me.role = "user";
    me.myPlayerId = "p1";
    const { onOpenBallot } = renderNudge();
    const nudge = screen.getByRole("button", { name: /Vote for the Season Awards/ });
    // The season is part of the headline, not the small print.
    expect(nudge.querySelector(".award-nudge-title")).toHaveTextContent(
      "Vote for the Season Awards · S4 · Summer",
    );
    expect(nudge.querySelector(".award-nudge-meta")).not.toHaveTextContent("Summer");
    expect(nudge).toHaveTextContent("2/6 picked");
    expect(nudge).toHaveTextContent("closes 15.10.2026");
    await userEvent.click(nudge);
    expect(onOpenBallot).toHaveBeenCalledWith("s4");
  });

  it("counts only the awards you can vote in", () => {
    me.role = "user";
    me.myPlayerId = "p1";
    // p2 ranked in S3 as well: no rookie besides you.
    renderNudge({
      seasons: [S5, S4, season({ id: "s3", number: 3, is_active: false })],
      seasonStats: [...STATS, stat("p2", "s3", 3)],
      votes: [vote("award_fun")],
    });
    expect(screen.getByRole("button")).toHaveTextContent("1/5 picked");
  });

  it("glows until every award you can vote in is picked", () => {
    me.role = "user";
    me.myPlayerId = "p1";
    const { rerender } = renderNudge();
    expect(screen.getByRole("button")).toHaveClass("shiny-card", "is-glowing");
    const all = (["award_offense", "award_defense", "award_fun", "award_community", "award_improved", "award_rookie"] as const).map(vote);
    rerender(
      <AwardVoteNudge
        seasons={[S5, S4]}
        votes={all}
        seasonStats={STATS}
        onOpenBallot={() => {}}
        now={T0 + DAY}
      />,
    );
    expect(screen.getByRole("button")).toHaveTextContent("6/6 picked");
    expect(screen.getByRole("button")).toHaveClass("shiny-card", "is-done");
    expect(screen.getByRole("button")).not.toHaveClass("is-glowing");
  });

  it("shows how many have voted, once turnout has loaded", () => {
    me.role = "user";
    me.myPlayerId = "p1";
    renderNudge({ turnout: { s4: { voters: 3, eligible: 9, awards: {} } } });
    expect(screen.getByRole("button")).toHaveTextContent("3/9 voted");
  });

  it("can't name a closing date while the season is still running", () => {
    me.role = "admin";
    me.myPlayerId = "p1";
    renderNudge({ seasons: [season({ voting_opened_at: iso(T0) })], votes: [] });
    expect(screen.getByRole("button")).toHaveTextContent(
      "0/6 picked · closes 14 days into the next season",
    );
  });

  it("shows one nudge per open ballot", () => {
    me.role = "user";
    me.myPlayerId = "p1";
    renderNudge({ seasons: [{ ...S5, voting_opened_at: iso(T0) }, S4] });
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      expect.stringContaining("S4 · Summer"),
      expect.stringContaining("S5 · Autumn"),
    ]);
  });

  it("asks an unlinked user to link their player instead", () => {
    me.role = "user";
    renderNudge();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Link your player to vote/)).toBeInTheDocument();
  });

  it("shows nothing to viewers and visitors", () => {
    me.role = "viewer";
    me.myPlayerId = "p1";
    const { container } = renderNudge();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing when no ballot is open", () => {
    me.role = "user";
    me.myPlayerId = "p1";
    const { container } = renderNudge({ now: T0 + 14 * DAY });
    expect(container).toBeEmptyDOMElement();
  });
});
