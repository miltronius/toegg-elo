import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SeasonAwardResults } from "./SeasonAwardResults";
import type { Season } from "../lib/supabase";
import type { AwardId, AwardResult } from "../lib/seasonAwards";

const DAY = 86_400_000;
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const season = (over: Partial<Season> = {}): Season => ({
  id: "s4",
  number: 4,
  name: "Summer",
  k_factor: 48,
  partner_weight: 0.25,
  inactivity_penalty_percent: 0,
  started_at: iso(NOW - 90 * DAY),
  ended_at: iso(NOW - 10 * DAY),
  is_active: false,
  created_at: iso(NOW - 90 * DAY),
  voting_closes_at: iso(NOW - DAY),
  ...over,
});
const PLAYERS = [
  { id: "p1", name: "Anna" },
  { id: "p2", name: "Ben" },
  { id: "p3", name: "Carla" },
];
const r = (award_id: AwardId, player_id: string, votes: number, is_winner = false): AwardResult => ({
  season_id: "s4",
  award_id,
  player_id,
  votes,
  is_winner,
});
const RESULTS = [
  r("award_offense", "p1", 3, true),
  r("award_offense", "p2", 1),
  r("award_fun", "p1", 2, true),
  r("award_fun", "p3", 2, true),
  r("award_defense", "p2", 1, true),
];

const award = (name: string) => screen.getByText(name).closest(".award-result") as HTMLElement;

describe("SeasonAwardResults", () => {
  it("shows each counted award's winners and ranking", () => {
    render(
      <SeasonAwardResults
        season={season({ awards_finalized_at: iso(NOW - DAY / 2) })}
        seasons={[season()]}
        results={RESULTS}
        players={PLAYERS}
      />,
    );
    expect(screen.getByText(/Season Awards/)).toBeInTheDocument();
    const offense = award("Best Offensive Player");
    expect(within(offense).getByText("Anna", { selector: ".award-result-winners" })).toBeInTheDocument();
    expect(within(offense).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Anna3 votes",
      "Ben1 vote",
    ]);
    expect(within(award("Most Fun to Play With")).getByText("Anna & Carla")).toBeInTheDocument();
    // However few the votes, the most-voted win once an admin counts.
    expect(within(award("Best Defender - The Wall")).getByText("Ben", { selector: ".award-result-winners" })).toBeInTheDocument();
    expect(within(award("Most Improved")).getByText("No votes")).toBeInTheDocument();
  });

  it("says the results are pending while a closed vote isn't counted", () => {
    render(<SeasonAwardResults season={season()} seasons={[season()]} results={[]} players={PLAYERS} />);
    expect(screen.getByText(/results follow once an admin counts/)).toBeInTheDocument();
  });

  it("shows nothing while voting hasn't closed", () => {
    const { container } = render(
      <SeasonAwardResults
        season={season({ voting_closes_at: iso(NOW + DAY) })}
        seasons={[season()]}
        results={[]}
        players={PLAYERS}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
