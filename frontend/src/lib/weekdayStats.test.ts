import { describe, it, expect } from "vitest";
import { computeWeekdayStats } from "./weekdayStats";
import type { EloHistory } from "./supabase";

// Noon-UTC timestamps so the calendar day (and thus weekday) is stable across
// the runner's timezone. Reference: 2024-01-01 is a Monday.
const eh = (
  created_at: string,
  elo_change: number,
  opts: { match_id?: string | null; season_id?: string | null } = {},
): EloHistory => ({
  id: created_at + ":" + elo_change,
  player_id: "p1",
  match_id: opts.match_id === undefined ? "m" : opts.match_id,
  season_id: opts.season_id === undefined ? "s1" : opts.season_id,
  elo_before: 1500,
  elo_after: 1500 + elo_change,
  elo_change,
  created_at,
});

const dayOf = (stats: ReturnType<typeof computeWeekdayStats>, day: string) =>
  stats.find((s) => s.day === day)!;

const HISTORY: EloHistory[] = [
  eh("2024-01-01T12:00:00Z", +10), // Mon win  (s1)
  eh("2024-01-08T12:00:00Z", -10), // Mon loss (s1)
  eh("2024-01-03T12:00:00Z", +5), // Wed win  (s1)
  eh("2024-01-06T12:00:00Z", +5), // Sat win  → excluded (weekend)
  eh("2024-01-15T12:00:00Z", -20, { match_id: null }), // Mon penalty → excluded
  eh("2024-01-02T12:00:00Z", +5, { season_id: "s2" }), // Tue win (s2)
];

describe("computeWeekdayStats", () => {
  it("always returns Monday–Friday in order", () => {
    const stats = computeWeekdayStats([], null);
    expect(stats.map((s) => s.day)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    expect(stats.every((s) => s.games === 0 && s.winrate === null)).toBe(true);
  });

  it("counts games and computes winrate per weekday (all-time)", () => {
    const stats = computeWeekdayStats(HISTORY, null);
    const mon = dayOf(stats, "Mon");
    expect(mon.games).toBe(2);
    expect(mon.wins).toBe(1);
    expect(mon.losses).toBe(1);
    expect(mon.winrate).toBe(50);

    const wed = dayOf(stats, "Wed");
    expect(wed.games).toBe(1);
    expect(wed.winrate).toBe(100);

    // Tue game belongs to s2 but all-time includes it.
    expect(dayOf(stats, "Tue").games).toBe(1);
  });

  it("excludes weekend games and inactivity-penalty rows", () => {
    const stats = computeWeekdayStats(HISTORY, null);
    // Sat win and the null-match_id penalty (a Monday) must not be counted.
    const totalGames = stats.reduce((n, s) => n + s.games, 0);
    expect(totalGames).toBe(4); // 2 Mon + 1 Wed + 1 Tue
    expect(dayOf(stats, "Mon").games).toBe(2); // penalty row not counted
  });

  it("filters to the selected season", () => {
    const stats = computeWeekdayStats(HISTORY, "s1");
    expect(dayOf(stats, "Mon").games).toBe(2);
    expect(dayOf(stats, "Wed").games).toBe(1);
    expect(dayOf(stats, "Tue").games).toBe(0); // Tue game was s2
    expect(dayOf(stats, "Tue").winrate).toBeNull();
  });

  it("reports null winrate for days with no decisive games", () => {
    const stats = computeWeekdayStats(HISTORY, null);
    expect(dayOf(stats, "Thu").games).toBe(0);
    expect(dayOf(stats, "Thu").winrate).toBeNull();
    expect(dayOf(stats, "Fri").winrate).toBeNull();
  });
});
