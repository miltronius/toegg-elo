import { describe, it, expect } from "vitest";
import {
  filterPlayers,
  nextHighlight,
  normalizeForSearch,
  sortPlayersByName,
} from "./playerSearch";

const p = (name: string) => ({ id: name.toLowerCase(), name });
const names = (list: { name: string }[]) => list.map((x) => x.name);

describe("sortPlayersByName", () => {
  it("sorts alphabetically, not by insertion order", () => {
    expect(names(sortPlayersByName([p("Zoe"), p("Ann"), p("Mia")]))).toEqual([
      "Ann",
      "Mia",
      "Zoe",
    ]);
  });

  it("is case-insensitive, so casing never splits the list", () => {
    expect(names(sortPlayersByName([p("bob"), p("Ann"), p("Zoe")]))).toEqual([
      "Ann",
      "bob",
      "Zoe",
    ]);
  });

  it("files umlauts with their base letter, not after z", () => {
    expect(names(sortPlayersByName([p("Zoe"), p("Ärni"), p("Bea")]))).toEqual([
      "Ärni",
      "Bea",
      "Zoe",
    ]);
  });

  it("does not mutate the array it is given", () => {
    const input = [p("Zoe"), p("Ann")];
    sortPlayersByName(input);
    expect(names(input)).toEqual(["Zoe", "Ann"]);
  });
});

describe("normalizeForSearch", () => {
  it("strips case, accents and surrounding space", () => {
    expect(normalizeForSearch("  Müller ")).toBe("muller");
    expect(normalizeForSearch("ÉLODIE")).toBe("elodie");
  });
});

describe("filterPlayers", () => {
  const roster = [p("Susanne"), p("Anna"), p("Müller"), p("Bea"), p("Andreas")];

  it("lists the whole roster alphabetically for an empty query", () => {
    expect(names(filterPlayers(roster, ""))).toEqual([
      "Andreas",
      "Anna",
      "Bea",
      "Müller",
      "Susanne",
    ]);
    expect(names(filterPlayers(roster, "   "))).toEqual(names(filterPlayers(roster, "")));
  });

  it("puts prefix matches before mere substring matches", () => {
    // Anna and Andreas start with "an"; Susanne only contains it.
    expect(names(filterPlayers(roster, "an"))).toEqual([
      "Andreas",
      "Anna",
      "Susanne",
    ]);
  });

  it("keeps each tier alphabetical", () => {
    expect(names(filterPlayers([p("Bob"), p("Ben"), p("Abe")], "b"))).toEqual([
      "Ben",
      "Bob",
      "Abe",
    ]);
  });

  it("finds an umlaut name typed without the umlaut", () => {
    expect(names(filterPlayers(roster, "muller"))).toEqual(["Müller"]);
    expect(names(filterPlayers(roster, "Mü"))).toEqual(["Müller"]);
  });

  it("ignores case", () => {
    expect(names(filterPlayers(roster, "BEA"))).toEqual(["Bea"]);
  });

  it("returns nothing when nobody matches", () => {
    expect(filterPlayers(roster, "zzz")).toEqual([]);
  });
});

describe("nextHighlight", () => {
  it("lands on the first entry from nothing when moving down", () => {
    expect(nextHighlight(-1, 1, 3)).toBe(0);
  });

  it("lands on the last entry from nothing when moving up", () => {
    expect(nextHighlight(-1, -1, 3)).toBe(2);
  });

  it("steps through the list", () => {
    expect(nextHighlight(0, 1, 3)).toBe(1);
    expect(nextHighlight(2, -1, 3)).toBe(1);
  });

  it("wraps at both ends so the list is reachable either way", () => {
    expect(nextHighlight(2, 1, 3)).toBe(0);
    expect(nextHighlight(0, -1, 3)).toBe(2);
  });

  it("has nothing to highlight in an empty list", () => {
    expect(nextHighlight(-1, 1, 0)).toBe(-1);
  });
});
