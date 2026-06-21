// Mirrors the pure ELO math in supabase/functions/calculate-elo/index.ts so the
// match form can preview win probability and projected ELO before recording a
// match. Duplicated rather than imported because the edge function runs on Deno
// and isn't reachable from the Vite build (same reasoning as elo_test.ts).

export type PlayerInput = {
  id: string;
  elo: number;
};

export type PlayerProjection = {
  playerId: string;
  currentElo: number;
  winElo: number;
  loseElo: number;
};

export type MatchPrediction = {
  teamAWinProbability: number;
  teamBWinProbability: number;
  teamA: [PlayerProjection, PlayerProjection];
  teamB: [PlayerProjection, PlayerProjection];
};

function getExpectedScore(playerElo: number, opponentElo: number): number {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
}

function calculateNewElo(
  playerElo: number,
  opponent1Elo: number,
  opponent2Elo: number,
  won: boolean,
  kFactor: number,
): number {
  const expectedScore =
    (getExpectedScore(playerElo, opponent1Elo) + getExpectedScore(playerElo, opponent2Elo)) / 2;
  return Math.round(playerElo + kFactor * ((won ? 1 : 0) - expectedScore));
}

export function predictMatch(
  teamA: [PlayerInput, PlayerInput],
  teamB: [PlayerInput, PlayerInput],
  kFactor = 32,
): MatchPrediction {
  const project = (player: PlayerInput, opp1Elo: number, opp2Elo: number): PlayerProjection => ({
    playerId: player.id,
    currentElo: player.elo,
    winElo: calculateNewElo(player.elo, opp1Elo, opp2Elo, true, kFactor),
    loseElo: calculateNewElo(player.elo, opp1Elo, opp2Elo, false, kFactor),
  });

  const teamAProjections: [PlayerProjection, PlayerProjection] = [
    project(teamA[0], teamB[0].elo, teamB[1].elo),
    project(teamA[1], teamB[0].elo, teamB[1].elo),
  ];
  const teamBProjections: [PlayerProjection, PlayerProjection] = [
    project(teamB[0], teamA[0].elo, teamA[1].elo),
    project(teamB[1], teamA[0].elo, teamA[1].elo),
  ];

  // Average of all 4 pairwise expected scores between team A and team B players.
  // Complementary by construction, so teamBWinProbability = 1 - teamAWinProbability.
  const teamAWinProbability =
    (getExpectedScore(teamA[0].elo, teamB[0].elo) +
      getExpectedScore(teamA[0].elo, teamB[1].elo) +
      getExpectedScore(teamA[1].elo, teamB[0].elo) +
      getExpectedScore(teamA[1].elo, teamB[1].elo)) /
    4;

  return {
    teamAWinProbability,
    teamBWinProbability: 1 - teamAWinProbability,
    teamA: teamAProjections,
    teamB: teamBProjections,
  };
}
