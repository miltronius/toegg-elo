import { describe, it, expect } from "vitest";
import {
  RANKED_MIN_GAMES,
  RosterCounts,
  defaultRosterFilter,
  filterRoster,
  isFilterAvailable,
  isRanked,
  minGamesFor,
  resolveRosterFilter,
  rosterCounts,
} from "./rosterFilter";

const p = (matches_played: number) => ({ matches_played });
/** n players with `games` each. */
const roster = (n: number, games: number) =>
  Array.from({ length: n }, () => p(games));
const counts = (all: number, played: number, ranked: number): RosterCounts => ({
  all,
  played,
  ranked,
});

describe("minGamesFor", () => {
  it("maps each filter to its threshold", () => {
    expect(minGamesFor("all")).toBe(0);
    expect(minGamesFor("played")).toBe(1);
    expect(minGamesFor("ranked")).toBe(RANKED_MIN_GAMES);
  });
});

describe("isRanked", () => {
  it("needs the full three games", () => {
    expect(isRanked(p(2))).toBe(false);
    expect(isRanked(p(3))).toBe(true);
    expect(isRanked(p(9))).toBe(true);
  });
});

describe("filterRoster", () => {
  const players = [p(0), p(1), p(2), p(3), p(10)];

  it("keeps everyone under 'all'", () => {
    expect(filterRoster(players, "all")).toHaveLength(5);
  });

  it("drops players with no games under 'played'", () => {
    expect(
      filterRoster(players, "played").map((x) => x.matches_played),
    ).toEqual([1, 2, 3, 10]);
  });

  it("keeps only players at or above the ranked threshold", () => {
    expect(
      filterRoster(players, "ranked").map((x) => x.matches_played),
    ).toEqual([3, 10]);
  });

  it("returns the same array instance for 'all' (no needless copy)", () => {
    expect(filterRoster(players, "all")).toBe(players);
  });
});

describe("rosterCounts", () => {
  it("counts each view in one pass", () => {
    expect(rosterCounts([p(0), p(0), p(1), p(2), p(3), p(12)])).toEqual({
      all: 6,
      played: 4,
      ranked: 2,
    });
  });

  it("handles an empty roster", () => {
    expect(rosterCounts([])).toEqual({ all: 0, played: 0, ranked: 0 });
  });
});

describe("isFilterAvailable", () => {
  it("offers a narrowing view as soon as one player qualifies", () => {
    expect(isFilterAvailable("ranked", counts(8, 4, 1))).toBe(true);
    expect(isFilterAvailable("played", counts(8, 1, 0))).toBe(true);
  });

  it("withholds a narrowing view that would show nobody", () => {
    expect(isFilterAvailable("ranked", counts(8, 4, 0))).toBe(false);
    expect(isFilterAvailable("played", counts(8, 0, 0))).toBe(false);
  });

  it("always offers 'all', even for an empty roster", () => {
    expect(isFilterAvailable("all", counts(0, 0, 0))).toBe(true);
  });
});

describe("defaultRosterFilter", () => {
  it("picks played from the very first match - 2v2 is exactly four players", () => {
    expect(
      defaultRosterFilter(rosterCounts([...roster(4, 1), ...roster(8, 0)])),
    ).toBe("played");
  });

  it("picks ranked once four players qualify", () => {
    expect(defaultRosterFilter(rosterCounts(roster(4, RANKED_MIN_GAMES)))).toBe(
      "ranked",
    );
  });

  it("holds off on ranked at three qualifiers, falling to played", () => {
    const players = [...roster(3, RANKED_MIN_GAMES), ...roster(5, 1)];
    expect(defaultRosterFilter(rosterCounts(players))).toBe("played");
  });

  it("never auto-selects a view short of a full match, however many have played", () => {
    // 10 players with a single game each: played is readable, ranked is empty.
    expect(defaultRosterFilter(rosterCounts(roster(10, 1)))).toBe("played");
  });

  it("falls back to the full roster when neither view is readable", () => {
    // 3 played, 1 ranked - both under the auto-select threshold.
    expect(
      defaultRosterFilter(rosterCounts([p(0), p(0), p(1), p(2), p(5)])),
    ).toBe("all");
  });

  it("falls back to the full roster for a season nobody has played", () => {
    expect(defaultRosterFilter(rosterCounts(roster(12, 0)))).toBe("all");
  });

  it("handles an empty roster", () => {
    expect(defaultRosterFilter(rosterCounts([]))).toBe("all");
  });
});

describe("resolveRosterFilter", () => {
  it("uses the default when nothing is pinned", () => {
    expect(resolveRosterFilter(null, counts(12, 10, 6))).toBe("ranked");
  });

  it("honours a pinned choice that still has data", () => {
    // Default would be ranked; the user asked for the whole roster.
    expect(resolveRosterFilter("all", counts(12, 10, 6))).toBe("all");
    expect(resolveRosterFilter("played", counts(12, 10, 6))).toBe("played");
  });

  it("honours a pinned narrowing view below the auto-select threshold", () => {
    // Only 2 ranked - too thin to auto-select, but fine to ask for.
    expect(resolveRosterFilter("ranked", counts(12, 8, 2))).toBe("ranked");
  });

  it("drops a pinned choice that has no data in the new scope", () => {
    // Pinned ranked, then switched to a season where nobody qualifies.
    expect(resolveRosterFilter("ranked", counts(12, 9, 0))).toBe("played");
    expect(resolveRosterFilter("ranked", counts(12, 3, 0))).toBe("all");
    expect(resolveRosterFilter("played", counts(12, 0, 0))).toBe("all");
  });
});
