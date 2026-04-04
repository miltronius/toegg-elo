import { createClient } from "@supabase/supabase-js";

// The anon key is also known as the publishable key in Supabase
// Both refer to the same public key found in your project settings
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseKey);

export type Role = "viewer" | "user" | "admin";

export type Profile = {
  id: string;
  email: string;
  role: Role;
  created_at: string;
};

export async function getMyRole(): Promise<Role> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user!.id)
    .single();
  if (error) throw error;
  return data.role as Role;
}

export async function getAllProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function updateUserRole(userId: string, role: Role) {
  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", userId);
  if (error) throw error;
}

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
  season_id: string | null;
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

export type Season = {
  id: string;
  number: number;
  name: string;
  k_factor: number;
  inactivity_penalty_percent: number;
  started_at: string;
  ended_at: string | null;
  is_active: boolean;
  created_at: string;
};

export type PlayerSeasonStats = {
  id: string;
  player_id: string;
  season_id: string;
  elo_at_start: number;
  current_season_elo: number;
  wins: number;
  losses: number;
  last_match_at: string | null;
  created_at: string;
};

export async function getActiveSeason(): Promise<Season | null> {
  const { data, error } = await supabase
    .from("seasons")
    .select("*")
    .eq("is_active", true)
    .single();
  if (error) return null;
  return data as Season;
}

export async function getSeasons(): Promise<Season[]> {
  const { data, error } = await supabase
    .from("seasons")
    .select("*")
    .order("number", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Season[];
}

export async function getPlayerSeasonStats(seasonId: string): Promise<PlayerSeasonStats[]> {
  const { data, error } = await supabase
    .from("player_season_stats")
    .select("*")
    .eq("season_id", seasonId);
  if (error) throw error;
  return (data ?? []) as PlayerSeasonStats[];
}

export async function endSeasonAndStartNew(
  newSeasonName: string,
  newKFactor: number,
  newPenaltyPercent: number,
): Promise<void> {
  const { error } = await supabase.rpc("end_season_and_start_new", {
    new_season_name: newSeasonName,
    new_k_factor: newKFactor,
    new_penalty_percent: newPenaltyPercent,
  });
  if (error) throw error;
}

export type TeamNameRow = {
  player_id_lo: string;
  player_id_hi: string;
  name: string | null;
  alias_1: string | null;
  alias_2: string | null;
  color: string | null;
  updated_at: string;
};

export async function getTeamNames(): Promise<TeamNameRow[]> {
  const { data, error } = await supabase.from("team_names").select("*");
  if (error) throw error;
  return data ?? [];
}

export async function upsertTeamName(
  playerIdLo: string,
  playerIdHi: string,
  name: string | null,
  alias1: string | null,
  alias2: string | null,
  color: string | null,
): Promise<void> {
  const { error } = await supabase.from("team_names").upsert(
    {
      player_id_lo: playerIdLo,
      player_id_hi: playerIdHi,
      name,
      alias_1: alias1,
      alias_2: alias2,
      color,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "player_id_lo,player_id_hi" },
  );
  if (error) throw error;
}

export async function getAllEloHistory(): Promise<EloHistory[]> {
  const { data, error } = await supabase
    .from("elo_history")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

export type { PlayerAchievementRow } from "./achievements";

export async function getAllPlayerAchievements() {
  const { data, error } = await supabase
    .from("player_achievements")
    .select("*");
  if (error) throw error;
  return (data ?? []) as import("./achievements").PlayerAchievementRow[];
}

export async function getPlayerAchievements(playerId: string) {
  const { data, error } = await supabase
    .from("player_achievements")
    .select("*")
    .eq("player_id", playerId);
  if (error) throw error;
  return (data ?? []) as import("./achievements").PlayerAchievementRow[];
}

export async function upsertPlayerAchievements(
  rows: Omit<import("./achievements").PlayerAchievementRow, "id">[],
): Promise<void> {
  const { error } = await supabase.from("player_achievements").upsert(rows, {
    onConflict: "player_id,achievement_id",
    ignoreDuplicates: false,
  });
  if (error) throw error;
}
