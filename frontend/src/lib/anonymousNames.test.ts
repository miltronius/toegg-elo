import { describe, it, expect } from "vitest";
import { MUSICIANS, generateAnonymousName } from "./anonymousNames";

describe("generateAnonymousName", () => {
  it("returns a musician whose name starts with the same letter as the real name", () => {
    const name = generateAnonymousName("Milton");
    expect(MUSICIANS.M).toContain(name);
    expect(name[0]).toBe("M");
  });

  it("is case-insensitive on the real name's first letter", () => {
    const name = generateAnonymousName("franz");
    expect(MUSICIANS.F).toContain(name);
  });

  it("avoids names already taken (case-insensitive)", () => {
    // Take all but one M musician; the result must be the remaining one.
    const remaining = MUSICIANS.M[0];
    const taken = MUSICIANS.M.slice(1).map((n) => n.toUpperCase());
    expect(generateAnonymousName("Mike", taken)).toBe(remaining);
  });

  it("falls back to another letter when the matching letter is exhausted", () => {
    const taken = [...MUSICIANS.M];
    const name = generateAnonymousName("Max", taken);
    expect(taken).not.toContain(name);
  });

  it("appends a numeric suffix when every musician is taken", () => {
    const taken = Object.values(MUSICIANS).flat();
    const name = generateAnonymousName("Milton", taken);
    expect(taken).not.toContain(name);
    expect(name).toMatch(/ \d+$/);
  });

  it("handles names with no leading A-Z letter without throwing", () => {
    expect(() => generateAnonymousName("123")).not.toThrow();
    expect(generateAnonymousName("123")).toBeTruthy();
  });
});
