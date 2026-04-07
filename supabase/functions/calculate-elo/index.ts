import { createClient } from "@supabase/supabase-js";
import { recomputeAllAchievements } from "../_shared/achievements.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface MatchRequest {
  teamAPlayer1Id: string;
  teamAPlayer2Id: string;
  teamBPlayer1Id: string;
  teamBPlayer2Id: string;
  winningTeam: "A" | "B";
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
}

// Calculate expected score against a single opponent
function getExpectedScore(playerElo: number, opponentElo: number): number {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
}

// ELO calculation for 2v2 - player faces both opponents
function calculateNewElo(
  playerElo: number,
  opponent1Elo: number,
  opponent2Elo: number,
  won: boolean,
  kFactor: number = 32,
): number {
  // Expected score against each opponent
  const expectedVsOpp1 = getExpectedScore(playerElo, opponent1Elo);
  const expectedVsOpp2 = getExpectedScore(playerElo, opponent2Elo);

  // Average expected score (player faces both opponents)
  const expectedScore = (expectedVsOpp1 + expectedVsOpp2) / 2;

  // Actual score (1 for win, 0 for loss)
  const actualScore = won ? 1 : 0;

  // New ELO
  const newElo = playerElo + kFactor * (actualScore - expectedScore);

  return Math.round(newElo);
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const matchData: MatchRequest = await req.json();

    // Validate input
    const {
      teamAPlayer1Id,
      teamAPlayer2Id,
      teamBPlayer1Id,
      teamBPlayer2Id,
      winningTeam,
    } = matchData;

    if (
      !teamAPlayer1Id ||
      !teamAPlayer2Id ||
      !teamBPlayer1Id ||
      !teamBPlayer2Id
    ) {
      return new Response(JSON.stringify({ error: "Missing player IDs" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase environment variables");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch active season to get k_factor and season_id
    const { data: activeSeason, error: seasonError } = await supabase
      .from("seasons")
      .select("id, k_factor")
      .eq("is_active", true)
      .single();

    if (seasonError || !activeSeason) {
      return new Response(
        JSON.stringify({ error: "No active season found" }),
        { status: 400, headers: corsHeaders },
      );
    }

    const seasonId = activeSeason.id;
    const kFactor: number = activeSeason.k_factor;

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
      return new Response(
        JSON.stringify({ error: "Could not fetch player data" }),
        { status: 400, headers: corsHeaders },
      );
    }

    // Fetch season ELO for each player — use this for ELO math so all players
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

    // Calculate new ELO for each player
    const eloChanges: EloChange[] = [];

    // Season ELOs used for calculation so ratings are comparable within a season.
    // The resulting delta is then applied to all-time current_elo for storage.
    const seasonEloA0 = getSeasonElo(teamA[0].id, teamA[0].current_elo);
    const seasonEloA1 = getSeasonElo(teamA[1].id, teamA[1].current_elo);
    const seasonEloB0 = getSeasonElo(teamB[0].id, teamB[0].current_elo);
    const seasonEloB1 = getSeasonElo(teamB[1].id, teamB[1].current_elo);

    const applyChange = (player: PlayerElo, seasonElo: number, opp1SeasonElo: number, opp2SeasonElo: number, won: boolean) => {
      const newSeasonElo = calculateNewElo(seasonElo, opp1SeasonElo, opp2SeasonElo, won, kFactor);
      const delta = newSeasonElo - seasonElo;
      eloChanges.push({
        playerId: player.id,
        eloBefore: player.current_elo,
        eloAfter: player.current_elo + delta,
        eloChange: delta,
      });
    };

    if (winningTeam === "A") {
      applyChange(teamA[0], seasonEloA0, seasonEloB0, seasonEloB1, true);
      applyChange(teamA[1], seasonEloA1, seasonEloB0, seasonEloB1, true);
      applyChange(teamB[0], seasonEloB0, seasonEloA0, seasonEloA1, false);
      applyChange(teamB[1], seasonEloB1, seasonEloA0, seasonEloA1, false);
    } else {
      applyChange(teamA[0], seasonEloA0, seasonEloB0, seasonEloB1, false);
      applyChange(teamA[1], seasonEloA1, seasonEloB0, seasonEloB1, false);
      applyChange(teamB[0], seasonEloB0, seasonEloA0, seasonEloA1, true);
      applyChange(teamB[1], seasonEloB1, seasonEloA0, seasonEloA1, true);
    }

    // Create match record
    const { data: matchResult, error: matchError } = await supabase
      .from("matches")
      .insert({
        team_a_player_1_id: teamAPlayer1Id,
        team_a_player_2_id: teamAPlayer2Id,
        team_b_player_1_id: teamBPlayer1Id,
        team_b_player_2_id: teamBPlayer2Id,
        winning_team: winningTeam,
        season_id: seasonId,
      })
      .select()
      .single();

    if (matchError || !matchResult) {
      return new Response(
        JSON.stringify({ error: "Could not create match record" }),
        { status: 400, headers: corsHeaders },
      );
    }

    const matchId = matchResult.id;

    // Update player ELOs and create history records
    for (const change of eloChanges) {
      const playerData = players.find((p) => p.id === change.playerId);

      // Update player ELO
      await supabase
        .from("players")
        .update({
          current_elo: change.eloAfter,
          matches_played: (playerData?.matches_played || 0) + 1,
          wins:
            change.eloChange > 0
              ? (playerData?.wins || 0) + 1
              : playerData?.wins || 0,
          losses:
            change.eloChange < 0
              ? (playerData?.losses || 0) + 1
              : playerData?.losses || 0,
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
      });

      // Update per-season stats
      await supabase.rpc("increment_season_stats", {
        p_player_id: change.playerId,
        p_season_id: seasonId,
        p_elo_before: change.eloBefore,
        p_elo_after: change.eloAfter,
        p_won: change.eloChange > 0,
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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
