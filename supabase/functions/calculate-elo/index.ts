import { createClient } from "@supabase/supabase-js";

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
// Achievement computation (inlined to stay within this function's import map)
// ---------------------------------------------------------------------------

type AchievementId =
  | "win_5" | "lose_5" | "play_20"
  | "all_weekdays" | "triple_day"
  | "best_friend" | "sworn_enemies";

interface AchievementPlayer {
  id: string;
  wins: number;
  losses: number;
  matches_played: number;
}

interface AchievementMatch {
  id: string;
  team_a_player_1_id: string;
  team_a_player_2_id: string;
  team_b_player_1_id: string;
  team_b_player_2_id: string;
  winning_team: string;
  created_at: string;
}

function tmCounts(playerId: string, matches: AchievementMatch[]): Map<string, number> {
  const c = new Map<string, number>();
  for (const m of matches) {
    const inA = m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
    const inB = m.team_b_player_1_id === playerId || m.team_b_player_2_id === playerId;
    if (!inA && !inB) continue;
    const tms = inA ? [m.team_a_player_1_id, m.team_a_player_2_id] : [m.team_b_player_1_id, m.team_b_player_2_id];
    for (const t of tms) { if (t !== playerId) c.set(t, (c.get(t) ?? 0) + 1); }
  }
  return c;
}

function oppCounts(playerId: string, matches: AchievementMatch[]): Map<string, number> {
  const c = new Map<string, number>();
  for (const m of matches) {
    const inA = m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
    const inB = m.team_b_player_1_id === playerId || m.team_b_player_2_id === playerId;
    if (!inA && !inB) continue;
    const opps = inA ? [m.team_b_player_1_id, m.team_b_player_2_id] : [m.team_a_player_1_id, m.team_a_player_2_id];
    for (const o of opps) c.set(o, (c.get(o) ?? 0) + 1);
  }
  return c;
}

function computeForPlayer(
  p: AchievementPlayer,
  matches: AchievementMatch[],
): { achievementId: AchievementId; meta: Record<string, unknown> | null }[] {
  const now = new Date().toISOString();
  const result: { achievementId: AchievementId; meta: Record<string, unknown> | null }[] = [];
  const pm = matches.filter(
    (m) => m.team_a_player_1_id === p.id || m.team_a_player_2_id === p.id ||
           m.team_b_player_1_id === p.id || m.team_b_player_2_id === p.id,
  );

  if (p.wins >= 5) result.push({ achievementId: "win_5", meta: null });
  if (p.losses >= 5) result.push({ achievementId: "lose_5", meta: null });
  if (p.matches_played >= 20) result.push({ achievementId: "play_20", meta: null });

  const days = new Set(pm.map((m) => new Date(m.created_at).getUTCDay()));
  if (days.size === 7) result.push({ achievementId: "all_weekdays", meta: null });

  const buckets = new Map<string, number>();
  for (const m of pm) { const d = m.created_at.slice(0, 10); buckets.set(d, (buckets.get(d) ?? 0) + 1); }
  if ([...buckets.values()].some((n) => n >= 3)) result.push({ achievementId: "triple_day", meta: null });

  let bestPid = "", bestCnt = 0;
  for (const [pid, cnt] of tmCounts(p.id, matches)) { if (cnt > bestCnt) { bestCnt = cnt; bestPid = pid; } }
  if (bestPid && bestCnt >= 10) result.push({ achievementId: "best_friend", meta: { partnerId: bestPid } });

  let topOid = "", topOcnt = 0;
  for (const [oid, cnt] of oppCounts(p.id, matches)) { if (cnt > topOcnt) { topOcnt = cnt; topOid = oid; } }
  if (topOid && topOcnt >= 10) result.push({ achievementId: "sworn_enemies", meta: { opponentId: topOid } });

  void now; // suppress unused warning
  return result;
}

// deno-lint-ignore no-explicit-any
async function recomputeAchievements(supabase: any, players: AchievementPlayer[], matches: AchievementMatch[]) {
  const rows: { player_id: string; achievement_id: string; unlocked_at: string; meta: Record<string, unknown> | null }[] = [];
  const now = new Date().toISOString();
  for (const player of players) {
    for (const { achievementId, meta } of computeForPlayer(player, matches)) {
      rows.push({ player_id: player.id, achievement_id: achievementId, unlocked_at: now, meta });
    }
  }
  if (rows.length === 0) return;
  const { error } = await supabase.from("player_achievements").upsert(rows, {
    onConflict: "player_id,achievement_id",
    ignoreDuplicates: false,
  });
  if (error) throw error;
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

    if (winningTeam === "A") {
      // Team A won
      teamA.forEach((player) => {
        const newElo = calculateNewElo(
          player.current_elo,
          teamB[0].current_elo,
          teamB[1].current_elo,
          true,
          kFactor,
        );
        eloChanges.push({
          playerId: player.id,
          eloBefore: player.current_elo,
          eloAfter: newElo,
          eloChange: newElo - player.current_elo,
        });
      });

      teamB.forEach((player) => {
        const newElo = calculateNewElo(
          player.current_elo,
          teamA[0].current_elo,
          teamA[1].current_elo,
          false,
          kFactor,
        );
        eloChanges.push({
          playerId: player.id,
          eloBefore: player.current_elo,
          eloAfter: newElo,
          eloChange: newElo - player.current_elo,
        });
      });
    } else {
      // Team B won
      teamA.forEach((player) => {
        const newElo = calculateNewElo(
          player.current_elo,
          teamB[0].current_elo,
          teamB[1].current_elo,
          false,
          kFactor,
        );
        eloChanges.push({
          playerId: player.id,
          eloBefore: player.current_elo,
          eloAfter: newElo,
          eloChange: newElo - player.current_elo,
        });
      });

      teamB.forEach((player) => {
        const newElo = calculateNewElo(
          player.current_elo,
          teamA[0].current_elo,
          teamA[1].current_elo,
          true,
          kFactor,
        );
        eloChanges.push({
          playerId: player.id,
          eloBefore: player.current_elo,
          eloAfter: newElo,
          eloChange: newElo - player.current_elo,
        });
      });
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
        p_elo_after: change.eloAfter,
        p_won: change.eloChange > 0,
      });
    }

    // Recompute achievements for all players (non-fatal)
    try {
      const { data: allPlayers } = await supabase.from("players").select("*");
      const { data: allMatches } = await supabase.from("matches").select("*");
      if (allPlayers && allMatches) {
        await recomputeAchievements(supabase, allPlayers, allMatches);
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
