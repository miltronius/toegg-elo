import { describe, it, expect } from "vitest";
import { predictMatch, projectSeries } from "./eloPrediction";

const player = (id: string, elo: number) => ({ id, elo });

const EVEN = [
  [player("a1", 1500), player("a2", 1500)],
  [player("b1", 1500), player("b2", 1500)],
] as const;

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
    const result = predictMatch([...EVEN[0]], [...EVEN[1]], 32);
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
    const result = predictMatch([...EVEN[0]], [...EVEN[1]], 0);
    for (const p of [...result.teamA, ...result.teamB]) {
      expect(p.winElo).toBe(p.currentElo);
      expect(p.loseElo).toBe(p.currentElo);
    }
  });

  it("exposes a per-game expectation that sums to 2 across the four players", () => {
    const result = predictMatch(
      [player("a1", 1880), player("a2", 1240)],
      [player("b1", 1610), player("b2", 1425)],
    );
    const total = [...result.teamA, ...result.teamB].reduce(
      (sum, p) => sum + p.expected,
      0,
    );
    expect(total).toBeCloseTo(2, 10);
  });

  describe("partner weight", () => {
    const mismatched = [
      [player("a1", 1900), player("a2", 1100)],
      [player("b1", 1500), player("b2", 1500)],
    ] as const;

    it("splits a win evenly at 0.5", () => {
      const result = predictMatch([...mismatched[0]], [...mismatched[1]], 32, 0.5);
      const gainStrong = result.teamA[0].winElo - result.teamA[0].currentElo;
      const gainWeak = result.teamA[1].winElo - result.teamA[1].currentElo;
      expect(gainStrong).toBe(gainWeak);
    });

    it("hands almost all of it to the carried player at 0", () => {
      const result = predictMatch([...mismatched[0]], [...mismatched[1]], 32, 0);
      const gainStrong = result.teamA[0].winElo - result.teamA[0].currentElo;
      const gainWeak = result.teamA[1].winElo - result.teamA[1].currentElo;
      expect(gainWeak).toBeGreaterThan(gainStrong * 5);
    });

    it("sits between the two at the default", () => {
      const ignored = predictMatch([...mismatched[0]], [...mismatched[1]], 32, 0);
      const blended = predictMatch([...mismatched[0]], [...mismatched[1]], 32);
      const averaged = predictMatch([...mismatched[0]], [...mismatched[1]], 32, 0.5);
      const gain = (r: ReturnType<typeof predictMatch>, i: 0 | 1) =>
        r.teamA[i].winElo - r.teamA[i].currentElo;

      expect(gain(blended, 0)).toBeGreaterThan(gain(ignored, 0));
      expect(gain(blended, 0)).toBeLessThan(gain(averaged, 0));
    });
  });
});

describe("projectSeries", () => {
  const teamA: [ReturnType<typeof player>, ReturnType<typeof player>] = [
    player("a1", 1640),
    player("a2", 1490),
  ];
  const teamB: [ReturnType<typeof player>, ReturnType<typeof player>] = [
    player("b1", 1555),
    player("b2", 1470),
  ];

  it("returns a delta for each of the four players", () => {
    const deltas = projectSeries(teamA, teamB, 2, 1, 32);
    expect(Object.keys(deltas).sort()).toEqual(["a1", "a2", "b1", "b2"]);
  });

  it("keeps the pool constant whatever the tally", () => {
    for (const [a, b] of [
      [1, 0],
      [2, 0],
      [2, 1],
      [3, 1],
      [3, 2],
      [0, 2],
    ]) {
      const deltas = projectSeries(teamA, teamB, a, b, 32);
      const total = Object.values(deltas).reduce((sum, d) => sum + d, 0);
      expect(total).toBe(0);
    }
  });

  it("rewards a sweep more than a close series", () => {
    const sweep = projectSeries(teamA, teamB, 2, 0, 32);
    const close = projectSeries(teamA, teamB, 2, 1, 32);
    expect(sweep.a1).toBeGreaterThan(close.a1);
  });

  it("matches the single-game projection for a 1-0 series", () => {
    const prediction = predictMatch(teamA, teamB, 32);
    const deltas = projectSeries(teamA, teamB, 1, 0, 32);
    expect(prediction.teamA[0].currentElo + deltas.a1).toBe(
      prediction.teamA[0].winElo,
    );
    expect(prediction.teamB[0].currentElo + deltas.b1).toBe(
      prediction.teamB[0].loseElo,
    );
  });

  it("can leave a heavy favourite worse off after a narrow series win", () => {
    const strong: [ReturnType<typeof player>, ReturnType<typeof player>] = [
      player("a1", 1700),
      player("a2", 1700),
    ];
    const weak: [ReturnType<typeof player>, ReturnType<typeof player>] = [
      player("b1", 1500),
      player("b2", 1500),
    ];
    const deltas = projectSeries(strong, weak, 3, 2, 32);
    expect(deltas.a1).toBeLessThan(0);
    expect(deltas.b1).toBeGreaterThan(0);
  });
});
