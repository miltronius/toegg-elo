import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  DEFAULT_PARTNER_WEIGHT,
  effectiveRatings,
  expectedScores,
  getExpectedScore,
  rateSeries,
  roundPreservingSum,
  teamWinProbability,
} from "../_shared/elo.ts";

// A spread of shapes: even, one lopsided team, both lopsided, mild edge.
const LINEUPS: [number, number, number, number][] = [
  [1500, 1500, 1500, 1500],
  [1900, 1100, 1500, 1500],
  [1900, 1100, 1600, 1400],
  [1800, 1700, 1300, 1200],
  [1700, 1500, 1550, 1450],
];

const WEIGHTS = [0, DEFAULT_PARTNER_WEIGHT, 0.5];

const sum = (deltas: { a1: number; a2: number; b1: number; b2: number }) =>
  deltas.a1 + deltas.a2 + deltas.b1 + deltas.b2;

// ── getExpectedScore ──────────────────────────────────────────────────────────

Deno.test("getExpectedScore: equal ELOs → 0.5", () => {
  assertEquals(getExpectedScore(1500, 1500), 0.5);
});

Deno.test("getExpectedScore: higher rated player has > 0.5 expected", () => {
  assertEquals(getExpectedScore(1600, 1400) > 0.5, true);
});

Deno.test("getExpectedScore: lower rated player has < 0.5 expected", () => {
  assertEquals(getExpectedScore(1400, 1600) < 0.5, true);
});

Deno.test("getExpectedScore: is complementary (A vs B + B vs A = 1)", () => {
  assertAlmostEquals(
    getExpectedScore(1600, 1400) + getExpectedScore(1400, 1600),
    1,
    1e-12,
  );
});

// ── Partner weighting ─────────────────────────────────────────────────────────

Deno.test("effectiveRatings: w=0 leaves both ratings alone", () => {
  assertEquals(effectiveRatings(1900, 1100, 0), [1900, 1100]);
});

Deno.test("effectiveRatings: w=0.5 collapses both onto the team average", () => {
  assertEquals(effectiveRatings(1900, 1100, 0.5), [1500, 1500]);
});

Deno.test("effectiveRatings: the pair's sum is untouched at any weight", () => {
  for (const w of WEIGHTS) {
    const [r1, r2] = effectiveRatings(1820, 1340, w);
    assertAlmostEquals(r1 + r2, 1820 + 1340, 1e-9);
  }
});

Deno.test("expectedScores: the four expectations always sum to 2", () => {
  for (const w of WEIGHTS) {
    for (const [a1, a2, b1, b2] of LINEUPS) {
      const e = expectedScores([a1, a2], [b1, b2], w);
      assertAlmostEquals(e.a1 + e.a2 + e.b1 + e.b2, 2, 1e-12);
    }
  }
});

Deno.test("teamWinProbability: complementary between the two teams", () => {
  for (const w of WEIGHTS) {
    for (const [a1, a2, b1, b2] of LINEUPS) {
      const pa = teamWinProbability([a1, a2], [b1, b2], w);
      const pb = teamWinProbability([b1, b2], [a1, a2], w);
      assertAlmostEquals(pa + pb, 1, 1e-12);
    }
  }
});

// ── The zero-sum invariant ────────────────────────────────────────────────────

Deno.test("rateSeries: deltas sum to exactly zero, at every weight", () => {
  for (const w of WEIGHTS) {
    for (const [a1, a2, b1, b2] of LINEUPS) {
      for (const [ag, bg] of [[1, 0], [2, 0], [2, 1], [3, 2], [0, 3]]) {
        const deltas = rateSeries([a1, a2], [b1, b2], ag, bg, 32, w);
        assertEquals(
          sum(deltas),
          0,
          `w=${w} lineup=${a1}/${a2}/${b1}/${b2} series=${ag}-${bg}`,
        );
      }
    }
  }
});

Deno.test("rateSeries: survives an odd K where the split doesn't round evenly", () => {
  for (const k of [7, 13, 24, 25, 33]) {
    const deltas = rateSeries([1712, 1488], [1603, 1399], 2, 1, k, 1 / 3);
    assertEquals(sum(deltas), 0, `k=${k}`);
  }
});

Deno.test("roundPreservingSum: keeps the total across a ragged split", () => {
  const values = [10.5, -3.25, -3.25, -4];
  const rounded = roundPreservingSum(values);
  assertEquals(rounded.reduce((s, v) => s + v, 0), 0);
  assertEquals(rounded.every(Number.isInteger), true);
});

// ── What the partner weight actually does ─────────────────────────────────────

Deno.test("rateSeries: w=0 ignores the partner entirely", () => {
  // Both teams average 1500, so with the partner ignored the 1100 player is a
  // huge underdog on paper and collects almost all of the win.
  const deltas = rateSeries([1900, 1100], [1500, 1500], 1, 0, 32, 0);
  assertEquals(deltas.a1, 3);
  assertEquals(deltas.a2, 29);
});

Deno.test("rateSeries: w=0.5 gives both partners the same delta", () => {
  for (const [a1, a2, b1, b2] of LINEUPS) {
    const deltas = rateSeries([a1, a2], [b1, b2], 2, 1, 32, 0.5);
    assertEquals(deltas.a1, deltas.a2);
    assertEquals(deltas.b1, deltas.b2);
  }
});

Deno.test("rateSeries: the default weight sits between the two extremes", () => {
  const ignored = rateSeries([1900, 1100], [1500, 1500], 1, 0, 32, 0);
  const blended = rateSeries(
    [1900, 1100],
    [1500, 1500],
    1,
    0,
    32,
    DEFAULT_PARTNER_WEIGHT,
  );
  const averaged = rateSeries([1900, 1100], [1500, 1500], 1, 0, 32, 0.5);

  // The carried player's share shrinks, the carrier's grows, monotonically.
  assertEquals(ignored.a1 < blended.a1 && blended.a1 < averaged.a1, true);
  assertEquals(ignored.a2 > blended.a2 && blended.a2 > averaged.a2, true);
});

Deno.test("rateSeries: equal teams split evenly whatever the weight", () => {
  for (const w of WEIGHTS) {
    const deltas = rateSeries([1500, 1500], [1500, 1500], 1, 0, 32, w);
    assertEquals(deltas, { a1: 16, a2: 16, b1: -16, b2: -16 });
  }
});

// ── Series scoring (sum of per-game residuals) ────────────────────────────────

Deno.test("rateSeries: a 1-0 series matches a single game at the same K", () => {
  // The behaviour every pre-series match was rated with, at w=0.
  const deltas = rateSeries([1600, 1600], [1400, 1400], 1, 0, 32, 0);
  const expected = Math.round(32 * (1 - getExpectedScore(1600, 1400)));
  assertEquals(deltas.a1, expected);
});

Deno.test("rateSeries: a sweep is worth more than a close series", () => {
  const sweep = rateSeries([1500, 1500], [1500, 1500], 2, 0, 32, 1 / 3);
  const close = rateSeries([1500, 1500], [1500, 1500], 2, 1, 32, 1 / 3);
  assertEquals(sweep.a1 > close.a1, true);
  assertEquals(sweep.a1, 32);
  assertEquals(close.a1, 16);
});

Deno.test("rateSeries: series length scales the swing between even teams", () => {
  const two = rateSeries([1500, 1500], [1500, 1500], 2, 0, 32, 1 / 3);
  const three = rateSeries([1500, 1500], [1500, 1500], 3, 0, 32, 1 / 3);
  assertEquals(three.a1, 48);
  assertEquals(two.a1, 32);
});

Deno.test("rateSeries: order of games within a series is irrelevant", () => {
  // Nothing in the model reads game order - E comes from the pre-series rating.
  const a = rateSeries([1620, 1480], [1550, 1390], 2, 1, 32, 1 / 3);
  const b = rateSeries([1620, 1480], [1550, 1390], 2, 1, 32, 1 / 3);
  assertEquals(a, b);
});

Deno.test("rateSeries: a heavy favourite can win a long series and lose rating", () => {
  // ~190 points of edge puts the per-game expectation above 3/5, so taking a
  // five-game series 3-2 is underperformance. Documented, not accidental.
  const deltas = rateSeries([1700, 1700], [1500, 1500], 3, 2, 32, 1 / 3);
  assertEquals(deltas.a1 < 0, true);
  assertEquals(deltas.b1 > 0, true);
  assertEquals(sum(deltas), 0);
});

Deno.test("rateSeries: upset win gains more than the expected win does", () => {
  const upset = rateSeries([1300, 1300], [1700, 1700], 2, 0, 32, 1 / 3);
  const expected = rateSeries([1700, 1700], [1300, 1300], 2, 0, 32, 1 / 3);
  assertEquals(upset.a1 > expected.a1, true);
});

Deno.test("rateSeries: K=0 means no ELO change", () => {
  const deltas = rateSeries([1600, 1400], [1500, 1300], 2, 1, 0, 1 / 3);
  assertEquals(deltas, { a1: 0, a2: 0, b1: 0, b2: 0 });
});

// ── Season ELO delta logic ────────────────────────────────────────────────────
// Mirrors index.ts: rate on season ELO, apply the delta to the all-time ELO.

function applyChange(
  currentElo: number,
  delta: number,
): { eloBefore: number; eloAfter: number; eloChange: number } {
  return {
    eloBefore: currentElo,
    eloAfter: currentElo + delta,
    eloChange: delta,
  };
}

Deno.test("season ELO: delta applied to all-time ELO, not season ELO", () => {
  // All four are at season ELO 1500; one of them carries an all-time 1700.
  const deltas = rateSeries([1500, 1500], [1500, 1500], 1, 0, 32, 1 / 3);
  const result = applyChange(1700, deltas.a1);
  assertEquals(result.eloBefore, 1700);
  assertEquals(result.eloAfter, 1716);
  assertEquals(result.eloChange, 16);
});

Deno.test("season ELO: all-time ELO does not influence the delta", () => {
  // Two players with very different all-time ELO but identical season ELO must
  // move by the same amount.
  const deltas = rateSeries([1500, 1500], [1500, 1500], 1, 0, 32, 1 / 3);
  assertEquals(
    applyChange(1800, deltas.a1).eloChange,
    applyChange(1300, deltas.a2).eloChange,
  );
});

Deno.test("season ELO: season ELO differences still affect delta size", () => {
  const highSeed = rateSeries([1700, 1700], [1300, 1300], 1, 0, 32, 1 / 3);
  const even = rateSeries([1500, 1500], [1500, 1500], 1, 0, 32, 1 / 3);
  assertEquals(highSeed.a1 < even.a1, true);
});
