import { createClient } from "@supabase/supabase-js";
import { recomputeAllAchievements } from "../_shared/achievements.ts";
import {
  DEFAULT_PARTNER_WEIGHT,
  MAX_SERIES_GAMES,
  rateSeries,
} from "../_shared/elo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** One game of a series. Goals are optional and never touch the ELO math. */
interface GameInput {
  w: "A" | "B";
  a: number | null;
  b: number | null;
}

interface MatchRequest {
  teamAPlayer1Id: string;
  teamAPlayer2Id: string;
  teamBPlayer1Id: string;
  teamBPlayer2Id: string;
  /** Absent on a pre-series client; see parseSeries. */
  games?: GameInput[];
  /** Only read when `games` is absent. */
  winningTeam?: "A" | "B";
}

interface PlayerElo {
  id: string;
  current_elo: number;
}

interface EloChange {
  playerId: string;
  eloBefore: number;
  eloAfter: number;
  eloChange: number;
  /**
   * Recorded rather than derived from the sign of eloChange: summing per-game
   * residuals means a favourite can win a series and still lose rating.
   */
  won: boolean;
}

type Series = {
  games: GameInput[] | null;
  teamAGames: number;
  teamBGames: number;
  winningTeam: "A" | "B";
};

const MAX_GOALS = 99;

const isGoals = (value: unknown): value is number =>
  value === null ||
  (typeof value === "number" && Number.isInteger(value) && value >= 0 &&
    value <= MAX_GOALS);

/**
 * Normalise the request into a series, or return why it can't be one.
 *
 * A body with no `games` is read as a single 1-0 game, which is exactly how
 * every match was recorded before series existed. That keeps a browser holding
 * an old bundle working through a deploy instead of failing every submission.
 */
function parseSeries(body: MatchRequest): { series: Series } | { error: string } {
  if (body.games === undefined) {
    if (body.winningTeam !== "A" && body.winningTeam !== "B") {
      return { error: "Missing games" };
    }
    return {
      series: {
        games: null,
        teamAGames: body.winningTeam === "A" ? 1 : 0,
        teamBGames: body.winningTeam === "B" ? 1 : 0,
        winningTeam: body.winningTeam,
      },
    };
  }

  const games = body.games;
  if (!Array.isArray(games) || games.length === 0) {
    return { error: "A match needs at least one game" };
  }
  if (games.length > MAX_SERIES_GAMES) {
    return { error: `A match can hold at most ${MAX_SERIES_GAMES} games` };
  }

  for (const game of games) {
    if (game?.w !== "A" && game?.w !== "B") {
      return { error: "Every game needs a winner" };
    }
    if (!isGoals(game.a) || !isGoals(game.b)) {
      return { error: "Goals must be whole numbers between 0 and 99" };
    }
    // Goals are optional, but if both are given they have to agree with the
    // winner - otherwise the stored detail would contradict the rating.
    if (game.a !== null && game.b !== null) {
      if (game.a === game.b) return { error: "A game cannot end level" };
      if ((game.a > game.b) !== (game.w === "A")) {
        return { error: "Game score contradicts its winner" };
      }
    }
  }

  const teamAGames = games.filter((g) => g.w === "A").length;
  const teamBGames = games.length - teamAGames;
  if (teamAGames === teamBGames) {
    return { error: "A match cannot end level" };
  }

  return {
    series: {
      games,
      teamAGames,
      teamBGames,
      winningTeam: teamAGames > teamBGames ? "A" : "B",
    },
  };
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const fail = (message: string, status = 400) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const matchData: MatchRequest = await req.json();

    const {
      teamAPlayer1Id,
      teamAPlayer2Id,
      teamBPlayer1Id,
      teamBPlayer2Id,
    } = matchData;

    if (
      !teamAPlayer1Id ||
      !teamAPlayer2Id ||
      !teamBPlayer1Id ||
      !teamBPlayer2Id
    ) {
      return fail("Missing player IDs");
    }

    const parsed = parseSeries(matchData);
    if ("error" in parsed) return fail(parsed.error);
    const { games, teamAGames, teamBGames, winningTeam } = parsed.series;

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase environment variables");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch active season for the rating parameters and season_id
    const { data: activeSeason, error: seasonError } = await supabase
      .from("seasons")
      .select("id, k_factor, partner_weight")
      .eq("is_active", true)
      .single();

    if (seasonError || !activeSeason) {
      return fail("No active season found");
    }

    const seasonId = activeSeason.id;
    const kFactor: number = activeSeason.k_factor;
    // Coerced because a numeric column can arrive as a string, and defaulted
    // because a database that predates the column should not rate at w = 0.
    const partnerWeight = activeSeason.partner_weight == null
      ? DEFAULT_PARTNER_WEIGHT
      : Number(activeSeason.partner_weight);

    // Fetch all 4 players' current ELO and stats
    const { data: players, error: fetchError } = await supabase
      .from("players")
      .select("id, current_elo, matches_played, wins, losses")
      .in("id", [
        teamAPlayer1Id,
        teamAPlayer2Id,
        teamBPlayer1Id,
        teamBPlayer2Id,
      ]);

    if (fetchError || !players || players.length !== 4) {
      return fail("Could not fetch player data");
    }

    // Fetch season ELO for each player - use this for ELO math so all players
    // start at 1500 at the beginning of a season (not their all-time ELO).
    const { data: seasonStats } = await supabase
      .from("player_season_stats")
      .select("player_id, current_season_elo")
      .eq("season_id", seasonId)
      .in("player_id", [
        teamAPlayer1Id,
        teamAPlayer2Id,
        teamBPlayer1Id,
        teamBPlayer2Id,
      ]);

    const seasonEloMap = new Map<string, number>();
    (seasonStats ?? []).forEach((s) =>
      seasonEloMap.set(s.player_id, s.current_season_elo)
    );

    // Returns season ELO; falls back to all-time ELO if no season stats yet.
    const getSeasonElo = (playerId: string, currentElo: number): number =>
      seasonEloMap.get(playerId) ?? currentElo;

    // Group players by team
    const playerMap = new Map<string, PlayerElo>();
    players.forEach((p) => playerMap.set(p.id, p));

    const teamA = [
      playerMap.get(teamAPlayer1Id)!,
      playerMap.get(teamAPlayer2Id)!,
    ];
    const teamB = [
      playerMap.get(teamBPlayer1Id)!,
      playerMap.get(teamBPlayer2Id)!,
    ];

    // Season ELOs used for calculation so ratings are comparable within a
    // season. The resulting deltas are then applied to all-time current_elo.
    const seasonEloA0 = getSeasonElo(teamA[0].id, teamA[0].current_elo);
    const seasonEloA1 = getSeasonElo(teamA[1].id, teamA[1].current_elo);
    const seasonEloB0 = getSeasonElo(teamB[0].id, teamB[0].current_elo);
    const seasonEloB1 = getSeasonElo(teamB[1].id, teamB[1].current_elo);

    // One call for all four players: the deltas have to be rounded together to
    // keep the rating pool constant.
    const deltas = rateSeries(
      [seasonEloA0, seasonEloA1],
      [seasonEloB0, seasonEloB1],
      teamAGames,
      teamBGames,
      kFactor,
      partnerWeight,
    );

    const toChange = (
      player: PlayerElo,
      delta: number,
      won: boolean,
    ): EloChange => ({
      playerId: player.id,
      eloBefore: player.current_elo,
      eloAfter: player.current_elo + delta,
      eloChange: delta,
      won,
    });

    const aWon = winningTeam === "A";
    const eloChanges: EloChange[] = [
      toChange(teamA[0], deltas.a1, aWon),
      toChange(teamA[1], deltas.a2, aWon),
      toChange(teamB[0], deltas.b1, !aWon),
      toChange(teamB[1], deltas.b2, !aWon),
    ];

    // Create match record
    const { data: matchResult, error: matchError } = await supabase
      .from("matches")
      .insert({
        team_a_player_1_id: teamAPlayer1Id,
        team_a_player_2_id: teamAPlayer2Id,
        team_b_player_1_id: teamBPlayer1Id,
        team_b_player_2_id: teamBPlayer2Id,
        winning_team: winningTeam,
        team_a_games: teamAGames,
        team_b_games: teamBGames,
        games,
        season_id: seasonId,
      })
      .select()
      .single();

    if (matchError || !matchResult) {
      return fail("Could not create match record");
    }

    const matchId = matchResult.id;

    // Update player ELOs and create history records
    for (const change of eloChanges) {
      const playerData = players.find((p) => p.id === change.playerId);

      // Update player ELO. Wins and losses count series, not games - one
      // recorded match stays one result everywhere else in the app.
      await supabase
        .from("players")
        .update({
          current_elo: change.eloAfter,
          matches_played: (playerData?.matches_played || 0) + 1,
          wins: (playerData?.wins || 0) + (change.won ? 1 : 0),
          losses: (playerData?.losses || 0) + (change.won ? 0 : 1),
        })
        .eq("id", change.playerId);

      // Create ELO history record
      await supabase.from("elo_history").insert({
        player_id: change.playerId,
        match_id: matchId,
        season_id: seasonId,
        elo_before: change.eloBefore,
        elo_after: change.eloAfter,
        elo_change: change.eloChange,
        won: change.won,
      });

      // Update per-season stats
      await supabase.rpc("increment_season_stats", {
        p_player_id: change.playerId,
        p_season_id: seasonId,
        p_elo_before: change.eloBefore,
        p_elo_after: change.eloAfter,
        p_won: change.won,
      });
    }

    // Recompute achievements for all players (non-fatal)
    try {
      const { data: allPlayers } = await supabase.from("players").select("*");
      const { data: allMatches } = await supabase.from("matches").select("*");
      if (allPlayers && allMatches) {
        await recomputeAllAchievements(supabase, allPlayers, allMatches);
      }
    } catch (err) {
      console.error("Achievement recompute failed (non-fatal):", err);
    }

    return new Response(
      JSON.stringify({
        success: true,
        matchId,
        eloChanges,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    console.error("Error:", error);
    return fail(error instanceof Error ? error.message : "Unexpected error", 500);
  }
});
