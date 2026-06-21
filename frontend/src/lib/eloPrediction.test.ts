import { describe, it, expect } from "vitest";
import { predictMatch } from "./eloPrediction";

const player = (id: string, elo: number) => ({ id, elo });

describe("predictMatch", () => {
  it("gives 50/50 win probability when all ELOs are equal", () => {
    const result = predictMatch(
      [player("a1", 1500), player("a2", 1500)],
      [player("b1", 1500), player("b2", 1500)],
    );
    expect(result.teamAWinProbability).toBeCloseTo(0.5);
    expect(result.teamBWinProbability).toBeCloseTo(0.5);
  });

  it("favors the higher-rated team", () => {
    const result = predictMatch(
      [player("a1", 1700), player("a2", 1700)],
      [player("b1", 1300), player("b2", 1300)],
    );
    expect(result.teamAWinProbability).toBeGreaterThan(0.5);
    expect(result.teamBWinProbability).toBeLessThan(0.5);
  });

  it("win/loss probabilities are complementary", () => {
    const result = predictMatch(
      [player("a1", 1620), player("a2", 1480)],
      [player("b1", 1550), player("b2", 1390)],
    );
    expect(result.teamAWinProbability + result.teamBWinProbability).toBeCloseTo(1);
  });

  it("projects ELO gain on win and loss for every player", () => {
    const result = predictMatch(
      [player("a1", 1500), player("a2", 1500)],
      [player("b1", 1500), player("b2", 1500)],
      32,
    );
    for (const p of [...result.teamA, ...result.teamB]) {
      expect(p.winElo).toBeGreaterThan(p.currentElo);
      expect(p.loseElo).toBeLessThan(p.currentElo);
    }
  });

  it("underdog gains more ELO from winning than the favorite does", () => {
    const result = predictMatch(
      [player("a1", 1300), player("a2", 1300)],
      [player("b1", 1700), player("b2", 1700)],
    );
    const underdogGain = result.teamA[0].winElo - result.teamA[0].currentElo;
    const favoriteGain = result.teamB[0].winElo - result.teamB[0].currentElo;
    expect(underdogGain).toBeGreaterThan(favoriteGain);
  });

  it("respects a custom K-factor", () => {
    const result = predictMatch(
      [player("a1", 1500), player("a2", 1500)],
      [player("b1", 1500), player("b2", 1500)],
      0,
    );
    for (const p of [...result.teamA, ...result.teamB]) {
      expect(p.winElo).toBe(p.currentElo);
      expect(p.loseElo).toBe(p.currentElo);
    }
  });
});
