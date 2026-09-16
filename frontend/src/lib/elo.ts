/**
 * Pure ELO math for 2v2 series. No DB calls, no imports, no browser or Deno APIs.
 *
 * This file exists twice and the two copies must stay byte-identical:
 *   - supabase/functions/_shared/elo.ts  (Deno edge function + its tests)
 *   - frontend/src/lib/elo.ts            (Vite build, match preview)
 * The edge function runs on Deno and isn't reachable from the Vite build, so it
 * is duplicated rather than imported - same reasoning as the achievements pair.
 *
 * ── The model ───────────────────────────────────────────────────────────────
 *
 * Each player's rating is blended with their partner's by `partnerWeight` (w),
 * then every player's expected score is the *average of their pairwise
 * expectations* against the two (also blended) opponents. The series is scored
 * by its **margin** - how far ahead the winners finished, not how many games it
 * took to get there:
 *
 *   r_a1 = (1-w)·R_a1 + w·R_a2      (symmetrically for a2, b1, b2)
 *   E_i  = ( expect(r_i, r_opp1) + expect(r_i, r_opp2) ) / 2
 *   d    = | gamesWon_A − gamesWon_B |                       the series margin
 *   Δ_i  = K · d · ( S_i − E_i )     S_i = 1 if i's team won the series, else 0
 *
 * w = 0   → the partner is ignored (the pre-2026-08 behaviour)
 * w = 0.5 → both partners share one effective rating; reduces exactly to the
 *           standard team-average model, and both get the same Δ
 * w = 1/4 → the default: the partner counts, but your own rating counts triple
 *
 * ── The invariant: the four deltas sum to zero ──────────────────────────────
 *
 * Averaging *expectations* is linear, and pairwise expectations are
 * complementary (expect(x,y) + expect(y,x) = 1), so the four E values always sum
 * to exactly 2. The margin puts 2·d points on the table (d to each of the two
 * winners), which is exactly d·ΣE - so the pool is constant. Two ways to break
 * it, both easy to do by accident:
 *
 *   1. Averaging the opponents' *ratings* instead of their expectations
 *      (expect(r_i, (r_o1+r_o2)/2)) - the logistic is not linear, so the sum
 *      drifts.
 *   2. Blending only your own team and leaving the opponents raw - player i's
 *      term and opponent j's term must read the same pair of effective ratings.
 *
 * Rounding is done once, over all four deltas together, so the stored integers
 * sum to zero too (see `roundPreservingSum`).
 */

/**
 * Neither ignore the partner nor merge with them: your rating counts triple.
 *
 * Written as 0.25 rather than 1/4 so it round-trips exactly through the
 * `<option value>` in SeasonDialog and through `seasons.partner_weight`'s
 * NUMERIC(4,3) - 1/3 came back from the DB as 0.333, which is not the constant.
 */
export const DEFAULT_PARTNER_WEIGHT = 0.25;

/** A partner can never count for more than you do. */
export const MAX_PARTNER_WEIGHT = 0.5;

/**
 * Most games one recorded series may hold. Not an ELO rule - just a shared
 * sanity bound so the match form and the edge function agree on what they will
 * accept. A lunch break doesn't hold ten games.
 */
export const MAX_SERIES_GAMES = 9;

export type Pair = readonly [number, number];

export type MatchExpectations = {
  a1: number;
  a2: number;
  b1: number;
  b2: number;
};

export type SeriesDeltas = MatchExpectations;

/** Standard ELO: probability that `playerElo` beats `opponentElo` in one game. */
export function getExpectedScore(
  playerElo: number,
  opponentElo: number,
): number {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
}

/**
 * Both teammates' ratings pulled `w` of the way towards each other. Their sum -
 * and therefore the team average - is unchanged, which is why w only moves
 * credit between partners and never in or out of the pool.
 */
export function effectiveRatings(r1: number, r2: number, w: number): Pair {
  return [(1 - w) * r1 + w * r2, (1 - w) * r2 + w * r1];
}

/** Per-game expected score for each of the four players. Always sums to 2. */
export function expectedScores(
  teamA: Pair,
  teamB: Pair,
  partnerWeight: number,
): MatchExpectations {
  const [a1, a2] = effectiveRatings(teamA[0], teamA[1], partnerWeight);
  const [b1, b2] = effectiveRatings(teamB[0], teamB[1], partnerWeight);
  const against = (self: number, opp1: number, opp2: number) =>
    (getExpectedScore(self, opp1) + getExpectedScore(self, opp2)) / 2;

  return {
    a1: against(a1, b1, b2),
    a2: against(a2, b1, b2),
    b1: against(b1, a1, a2),
    b2: against(b2, a1, a2),
  };
}

/**
 * Team A's chance of taking any single game. Complementary with team B's by
 * construction, since all four expectations sum to 2.
 */
export function teamWinProbability(
  teamA: Pair,
  teamB: Pair,
  partnerWeight: number,
): number {
  const e = expectedScores(teamA, teamB, partnerWeight);
  return (e.a1 + e.a2) / 2;
}

/**
 * Round to integers without changing the total (largest-remainder).
 *
 * Rounding each delta on its own would leak up to 2 points per match into or out
 * of the pool. Here the spare point goes to whoever's fractional part is
 * largest, so the sum survives.
 */
export function roundPreservingSum(values: number[]): number[] {
  const floored = values.map((v) => Math.floor(v));
  const target = Math.round(values.reduce((sum, v) => sum + v, 0));
  const deficit = target - floored.reduce((sum, v) => sum + v, 0);

  const byRemainder = values
    .map((v, index) => ({ index, remainder: v - Math.floor(v) }))
    .sort((x, y) => y.remainder - x.remainder);

  const result = [...floored];
  for (let i = 0; i < deficit; i++) {
    result[byRemainder[i % byRemainder.length].index] += 1;
  }
  return result;
}

/**
 * Rating change for every player from one series.
 *
 * The series is reduced to its **margin** and rated as if it were a d:0 sweep:
 * a 2:1 counts as a 1:0, a 3:1 as a 2:0. Drawn pairs of games cancel out. So
 * the margin is the whole signal and the number of games played is none of it.
 *
 * Why margin rather than the FIDE sum-of-residuals (`Σ_games (S − E)`, which
 * this ran on until 2026-09): that model assumes the game count is fixed in
 * advance and independent of the results. In a lunch-break league it is not -
 * people play until someone is clearly ahead or until the hour runs out, a
 * stopping rule that depends on the margin. Under such a rule the game count
 * says nothing about who is stronger, so dropping it discards noise rather than
 * evidence. Two things fall out of that:
 *
 *   - **Winning can never cost you rating.** A winner's Δ is K·d·(1 − E) with
 *     E < 1 and d ≥ 1, so it is always positive. The old model could hand a
 *     heavy favourite −60 for taking a series 3:2, because its `n · E` term
 *     grew with the series length.
 *   - **K needs no recalibration.** The two models agree exactly on every sweep,
 *     and everywhere when all four ratings are equal (there both reduce to
 *     Δ = K·(w − l)/2). Only non-sweeps between unequal teams move.
 *
 * The cost, stated plainly: a 5:4 grind and a 1:0 are now the same result. Nine
 * games of near-parity read as "won by one". If sessions ever get long enough
 * for that to matter, a sub-linear discount on d is where it would go.
 *
 * E is taken once from the pre-series ratings, so the result doesn't depend on
 * the order the games were played in. A level series is rejected by a CHECK
 * constraint on `matches`, so d ≥ 1 and there is no "nobody moves" case.
 */
export function rateSeries(
  teamA: Pair,
  teamB: Pair,
  teamAGames: number,
  teamBGames: number,
  kFactor: number,
  partnerWeight: number,
): SeriesDeltas {
  const e = expectedScores(teamA, teamB, partnerWeight);
  const margin = Math.abs(teamAGames - teamBGames);
  const scoreA = teamAGames > teamBGames ? margin : 0;
  const scoreB = teamBGames > teamAGames ? margin : 0;

  const [a1, a2, b1, b2] = roundPreservingSum([
    kFactor * (scoreA - margin * e.a1),
    kFactor * (scoreA - margin * e.a2),
    kFactor * (scoreB - margin * e.b1),
    kFactor * (scoreB - margin * e.b2),
  ]);

  return { a1, a2, b1, b2 };
}
