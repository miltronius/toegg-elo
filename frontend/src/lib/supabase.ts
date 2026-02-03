import { createClient } from "@supabase/supabase-js";

// The anon key is also known as the publishable key in Supabase
// Both refer to the same public key found in your project settings
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseKey);

export type Player = {
  id: string;
  name: string;
  current_elo: number;
  matches_played: number;
  wins: number;
  losses: number;
  created_at: string;
};

export type Match = {
  id: string;
  team_a_player_1_id: string;
  team_a_player_2_id: string;
  team_b_player_1_id: string;
  team_b_player_2_id: string;
  winning_team: "A" | "B";
  created_at: string;
};

export type EloHistory = {
  id: string;
  player_id: string;
  match_id: string;
  elo_before: number;
  elo_after: number;
  elo_change: number;
  created_at: string;
};

export async function getPlayers(): Promise<Player[]> {
  const { data, error } = await supabase
    .from("players")
    .select("*")
    .order("current_elo", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function createPlayer(name: string): Promise<Player> {
  const { data, error } = await supabase
    .from("players")
    .insert({ name })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function recordMatch(
  teamAPlayer1Id: string,
  teamAPlayer2Id: string,
  teamBPlayer1Id: string,
  teamBPlayer2Id: string,
  winningTeam: "A" | "B",
) {
  const response = await supabase.functions.invoke("calculate-elo", {
    body: {
      teamAPlayer1Id,
      teamAPlayer2Id,
      teamBPlayer1Id,
      teamBPlayer2Id,
      winningTeam,
    },
  });

  if (response.error) throw response.error;
  return response.data;
}

export async function getMatches(): Promise<Match[]> {
  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getEloHistory(playerId: string): Promise<EloHistory[]> {
  const { data, error } = await supabase
    .from("elo_history")
    .select("*")
    .eq("player_id", playerId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function deleteMatch(matchId: string) {
  // First, get the match to know which players were involved
  const { data: matchData } = await supabase
    .from("matches")
    .select(
      "team_a_player_1_id, team_a_player_2_id, team_b_player_1_id, team_b_player_2_id",
    )
    .eq("id", matchId)
    .single();

  if (!matchData) throw new Error("Match not found");

  const affectedPlayerIds = [
    matchData.team_a_player_1_id,
    matchData.team_a_player_2_id,
    matchData.team_b_player_1_id,
    matchData.team_b_player_2_id,
  ];

  // Delete elo_history records for this match
  const { error: historyError } = await supabase
    .from("elo_history")
    .delete()
    .eq("match_id", matchId);

  if (historyError) throw historyError;

  // Delete the match
  const { error: matchError } = await supabase
    .from("matches")
    .delete()
    .eq("id", matchId);

  if (matchError) throw matchError;

  // Recalculate stats for each affected player
  for (const playerId of affectedPlayerIds) {
    const playerHistory = await getEloHistory(playerId);

    if (playerHistory.length > 0) {
      const lastEntry = playerHistory[0];
      await supabase
        .from("players")
        .update({
          current_elo: lastEntry.elo_after,
          matches_played: playerHistory.length,
          wins: playerHistory.filter((h) => h.elo_change > 0).length,
          losses: playerHistory.filter((h) => h.elo_change < 0).length,
        })
        .eq("id", playerId);
    } else {
      // Reset to default if no history left
      await supabase
        .from("players")
        .update({
          current_elo: 1500,
          matches_played: 0,
          wins: 0,
          losses: 0,
        })
        .eq("id", playerId);
    }
  }
}

export async function deletePlayer(playerId: string) {
  // Delete all elo_history for this player
  await supabase.from("elo_history").delete().eq("player_id", playerId);

  // Delete all matches involving this player
  const { data: matches } = await supabase
    .from("matches")
    .select("id")
    .or(
      `team_a_player_1_id.eq.${playerId},team_a_player_2_id.eq.${playerId},team_b_player_1_id.eq.${playerId},team_b_player_2_id.eq.${playerId}`,
    );

  if (matches) {
    for (const match of matches) {
      await deleteMatch(match.id);
    }
  }

  // Delete the player
  const { error } = await supabase.from("players").delete().eq("id", playerId);

  if (error) throw error;
}

export async function updatePlayerName(playerId: string, newName: string) {
  const { error } = await supabase
    .from("players")
    .update({ name: newName })
    .eq("id", playerId);

  if (error) throw error;
}
