import { assertEquals } from "@std/assert";

// ── Pure ELO math (duplicated from index.ts to keep function testable) ────────

function getExpectedScore(playerElo: number, opponentElo: number): number {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
}

function calculateNewElo(
  playerElo: number,
  opponent1Elo: number,
  opponent2Elo: number,
  won: boolean,
  kFactor: number = 32,
): number {
  const expectedScore =
    (getExpectedScore(playerElo, opponent1Elo) +
      getExpectedScore(playerElo, opponent2Elo)) /
    2;
  const actualScore = won ? 1 : 0;
  return Math.round(playerElo + kFactor * (actualScore - expectedScore));
}

// ── getExpectedScore ──────────────────────────────────────────────────────────

Deno.test("getExpectedScore: equal ELOs → 0.5", () => {
  assertEquals(getExpectedScore(1500, 1500), 0.5);
});

Deno.test("getExpectedScore: higher rated player has > 0.5 expected", () => {
  const score = getExpectedScore(1600, 1400);
  assertEquals(score > 0.5, true);
});

Deno.test("getExpectedScore: lower rated player has < 0.5 expected", () => {
  const score = getExpectedScore(1400, 1600);
  assertEquals(score < 0.5, true);
});

Deno.test("getExpectedScore: is complementary (A vs B + B vs A = 1)", () => {
  const ab = getExpectedScore(1600, 1400);
  const ba = getExpectedScore(1400, 1600);
  // floating point: check within epsilon
  assertEquals(Math.abs(ab + ba - 1) < 1e-10, true);
});

// ── calculateNewElo ───────────────────────────────────────────────────────────

Deno.test("calculateNewElo: equal teams, winner gains ELO", () => {
  const newElo = calculateNewElo(1500, 1500, 1500, true);
  assertEquals(newElo > 1500, true);
});

Deno.test("calculateNewElo: equal teams, loser loses ELO", () => {
  const newElo = calculateNewElo(1500, 1500, 1500, false);
  assertEquals(newElo < 1500, true);
});

Deno.test("calculateNewElo: equal teams, win gain = loss penalty (symmetric)", () => {
  const gain = calculateNewElo(1500, 1500, 1500, true) - 1500;
  const loss = 1500 - calculateNewElo(1500, 1500, 1500, false);
  assertEquals(gain, loss);
});

Deno.test("calculateNewElo: upset win gives larger gain than expected win", () => {
  // Underdog beats heavy favourites
  const upsetGain = calculateNewElo(1300, 1700, 1700, true) - 1300;
  // Favourite beats underdogs
  const expectedGain = calculateNewElo(1700, 1300, 1300, true) - 1700;
  assertEquals(upsetGain > expectedGain, true);
});

Deno.test("calculateNewElo: heavily favoured winner gains little ELO", () => {
  const gain = calculateNewElo(1800, 1300, 1300, true) - 1800;
  assertEquals(gain >= 0 && gain < 5, true);
});

Deno.test("calculateNewElo: expected loser loses little ELO", () => {
  // Underdog loses to heavy favourites — expected outcome, should cost little
  const loss = 1300 - calculateNewElo(1300, 1800, 1800, false);
  assertEquals(loss >= 0 && loss < 5, true);
});

Deno.test("calculateNewElo: K=0 means no ELO change", () => {
  assertEquals(calculateNewElo(1500, 1500, 1500, true, 0), 1500);
  assertEquals(calculateNewElo(1600, 1400, 1400, false, 0), 1600);
});
