// Match-form preview: win probability and projected ELO before a series is
// recorded. The math itself lives in ./elo, which is mirrored byte-for-byte into
// supabase/functions/_shared/elo.ts - so what the form shows and what the edge
// function writes cannot drift.

import {
  DEFAULT_PARTNER_WEIGHT,
  expectedScores,
  rateSeries,
  teamWinProbability,
} from "./elo";

export type PlayerInput = {
  id: string;
  elo: number;
};

export type PlayerProjection = {
  playerId: string;
  currentElo: number;
  /** Elo after winning one game, then after losing one. */
  winElo: number;
  loseElo: number;
  /** Per-game expected score, so any series tally can be priced from it. */
  expected: number;
};

export type MatchPrediction = {
  teamAWinProbability: number;
  teamBWinProbability: number;
  teamA: [PlayerProjection, PlayerProjection];
  teamB: [PlayerProjection, PlayerProjection];
};

export function predictMatch(
  teamA: [PlayerInput, PlayerInput],
  teamB: [PlayerInput, PlayerInput],
  kFactor = 32,
  partnerWeight = DEFAULT_PARTNER_WEIGHT,
): MatchPrediction {
  const ratingsA: [number, number] = [teamA[0].elo, teamA[1].elo];
  const ratingsB: [number, number] = [teamB[0].elo, teamB[1].elo];

  const expected = expectedScores(ratingsA, ratingsB, partnerWeight);
  // A single game either way, which is what the chips show before any game has
  // been entered.
  const aWins = rateSeries(ratingsA, ratingsB, 1, 0, kFactor, partnerWeight);
  const bWins = rateSeries(ratingsA, ratingsB, 0, 1, kFactor, partnerWeight);

  return {
    teamAWinProbability: teamWinProbability(ratingsA, ratingsB, partnerWeight),
    teamBWinProbability: teamWinProbability(ratingsB, ratingsA, partnerWeight),
    teamA: [
      {
        playerId: teamA[0].id,
        currentElo: teamA[0].elo,
        winElo: teamA[0].elo + aWins.a1,
        loseElo: teamA[0].elo + bWins.a1,
        expected: expected.a1,
      },
      {
        playerId: teamA[1].id,
        currentElo: teamA[1].elo,
        winElo: teamA[1].elo + aWins.a2,
        loseElo: teamA[1].elo + bWins.a2,
        expected: expected.a2,
      },
    ],
    teamB: [
      {
        playerId: teamB[0].id,
        currentElo: teamB[0].elo,
        winElo: teamB[0].elo + bWins.b1,
        loseElo: teamB[0].elo + aWins.b1,
        expected: expected.b1,
      },
      {
        playerId: teamB[1].id,
        currentElo: teamB[1].elo,
        winElo: teamB[1].elo + bWins.b2,
        loseElo: teamB[1].elo + aWins.b2,
        expected: expected.b2,
      },
    ],
  };
}

/**
 * Where a player lands if the series ends on this tally.
 *
 * Recomputed from the ratings rather than scaled from the projection, because
 * the four deltas are rounded together to keep the pool constant - doing it per
 * player here would show a number the edge function won't write.
 */
export function projectSeries(
  teamA: [PlayerInput, PlayerInput],
  teamB: [PlayerInput, PlayerInput],
  teamAGames: number,
  teamBGames: number,
  kFactor = 32,
  partnerWeight = DEFAULT_PARTNER_WEIGHT,
): Record<string, number> {
  const deltas = rateSeries(
    [teamA[0].elo, teamA[1].elo],
    [teamB[0].elo, teamB[1].elo],
    teamAGames,
    teamBGames,
    kFactor,
    partnerWeight,
  );
  return {
    [teamA[0].id]: deltas.a1,
    [teamA[1].id]: deltas.a2,
    [teamB[0].id]: deltas.b1,
    [teamB[1].id]: deltas.b2,
  };
}
