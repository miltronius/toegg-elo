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
