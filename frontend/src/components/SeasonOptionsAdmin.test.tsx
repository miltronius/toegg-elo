import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SeasonOptionsAdmin } from "./SeasonOptionsAdmin";
import type { Season } from "../lib/supabase";

vi.mock("../lib/supabase", () => ({
  closeAwardVoting: vi.fn(),
  finalizeSeasonAwards: vi.fn(),
  openAwardVoting: vi.fn(),
  updateSeasonVotingSchedule: vi.fn(),
}));

const DAY = 86_400_000;
const T0 = new Date(2026, 9, 1, 12, 0).getTime();
const iso = (ms: number) => new Date(ms).toISOString();
const season = (over: Partial<Season>): Season => ({
  id: "s5",
  number: 5,
  name: "Autumn",
  k_factor: 48,
  partner_weight: 0.25,
  inactivity_penalty_percent: 0,
  started_at: iso(T0 - DAY),
  ended_at: null,
  is_active: true,
  created_at: iso(T0 - DAY),
  planned_end_at: null,
  voting_opened_at: null,
  voting_closes_at: null,
  ...over,
});
const S5 = season({});
// S4 ended when S5 started, a day ago: its ballot is open for 13 more days.
const S4 = season({
  id: "s4",
  number: 4,
  name: "Summer",
  is_active: false,
  started_at: iso(T0 - 90 * DAY),
  ended_at: iso(T0 - DAY),
});

const headings = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);

describe("SeasonOptionsAdmin", () => {
  it("manages the previous season while its ballot is open, then the running one", () => {
    render(<SeasonOptionsAdmin seasons={[S5, S4]} onChanged={() => {}} now={T0} />);
    expect(headings()).toEqual([
      expect.stringContaining("S4 · Summer"),
      expect.stringContaining("S5 · Autumn"),
    ]);
  });

  it("keeps the previous season after its default close, until counted", () => {
    render(<SeasonOptionsAdmin seasons={[S5, S4]} onChanged={() => {}} now={T0 + 14 * DAY} />);
    expect(headings()[0]).toContain("S4 · Summer");
  });

  it("keeps a closed but uncounted previous season, so it can be counted", () => {
    const closed = { ...S4, voting_closes_at: iso(T0 - 1000) };
    render(<SeasonOptionsAdmin seasons={[S5, closed]} onChanged={() => {}} now={T0} />);
    expect(headings()[0]).toContain("S4 · Summer");
  });

  it("drops the previous season once it's counted", () => {
    const done = { ...S4, voting_closes_at: iso(T0 - 1000), awards_finalized_at: iso(T0 - 500) };
    render(<SeasonOptionsAdmin seasons={[S5, done]} onChanged={() => {}} now={T0} />);
    expect(headings()).toEqual([expect.stringContaining("S5 · Autumn")]);
  });

  it("has nothing to manage without a running season", () => {
    render(<SeasonOptionsAdmin seasons={[]} onChanged={() => {}} now={T0} />);
    expect(screen.queryAllByRole("heading", { level: 3 })).toEqual([]);
  });
});
