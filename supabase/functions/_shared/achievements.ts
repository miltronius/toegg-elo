// Deno-compatible version of frontend/src/lib/achievements.ts
// No browser-specific imports. Used by the calculate-elo edge function.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Types (mirrored from frontend)
// ---------------------------------------------------------------------------

export type AchievementId =
  | "win_1"
  | "win_5"
  | "win_10"
  | "win_20"
  | "win_50"
  | "lose_1"
  | "lose_5"
  | "lose_10"
  | "lose_20"
  | "lose_50"
  | "play_10"
  | "play_20"
  | "play_50"
  | "play_100"
  | "play_200"
  | "all_weekdays"
  | "triple_day"
  | "triple_win_day"
  | "best_friend"
  | "bff"
  | "sworn_enemies"
  | "arch_nemesis"
  | "achievement_hunter";

interface Player {
  id: string;
  name: string;
  current_elo: number;
  matches_played: number;
  wins: number;
  losses: number;
  created_at: string;
}

interface Match {
  id: string;
  team_a_player_1_id: string;
  team_a_player_2_id: string;
  team_b_player_1_id: string;
  team_b_player_2_id: string;
  winning_team: "A" | "B";
  created_at: string;
}

interface UnlockedAchievement {
  achievementId: AchievementId;
  unlockedAt: Date;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeTeammateCounts(
  playerId: string,
  matches: Match[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of matches) {
    const inA =
      m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
    const inB =
      m.team_b_player_1_id === playerId || m.team_b_player_2_id === playerId;
    if (!inA && !inB) continue;
    const teammates = inA
      ? [m.team_a_player_1_id, m.team_a_player_2_id]
      : [m.team_b_player_1_id, m.team_b_player_2_id];
    for (const tmId of teammates) {
      if (tmId === playerId) continue;
      counts.set(tmId, (counts.get(tmId) ?? 0) + 1);
    }
  }
  return counts;
}

function computeOpponentCounts(
  playerId: string,
  matches: Match[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of matches) {
    const inA =
      m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
    const inB =
      m.team_b_player_1_id === playerId || m.team_b_player_2_id === playerId;
    if (!inA && !inB) continue;
    const opponents = inA
      ? [m.team_b_player_1_id, m.team_b_player_2_id]
      : [m.team_a_player_1_id, m.team_a_player_2_id];
    for (const oppId of opponents) {
      counts.set(oppId, (counts.get(oppId) ?? 0) + 1);
    }
  }
  return counts;
}

function computeAchievementsForPlayer(
  playerId: string,
  player: Player,
  matches: Match[],
): UnlockedAchievement[] {
  const now = new Date();
  const unlocked: UnlockedAchievement[] = [];

  const playerMatches = matches.filter(
    (m) =>
      m.team_a_player_1_id === playerId ||
      m.team_a_player_2_id === playerId ||
      m.team_b_player_1_id === playerId ||
      m.team_b_player_2_id === playerId,
  );

  // win milestones
  if (player.wins >= 1) unlocked.push({ achievementId: "win_1", unlockedAt: now });
  if (player.wins >= 5) unlocked.push({ achievementId: "win_5", unlockedAt: now });
  if (player.wins >= 10) unlocked.push({ achievementId: "win_10", unlockedAt: now });
  if (player.wins >= 20) unlocked.push({ achievementId: "win_20", unlockedAt: now });
  if (player.wins >= 50) unlocked.push({ achievementId: "win_50", unlockedAt: now });

  // lose milestones
  if (player.losses >= 1) unlocked.push({ achievementId: "lose_1", unlockedAt: now });
  if (player.losses >= 5) unlocked.push({ achievementId: "lose_5", unlockedAt: now });
  if (player.losses >= 10) unlocked.push({ achievementId: "lose_10", unlockedAt: now });
  if (player.losses >= 20) unlocked.push({ achievementId: "lose_20", unlockedAt: now });
  if (player.losses >= 50) unlocked.push({ achievementId: "lose_50", unlockedAt: now });
  // play milestones
  if (player.matches_played >= 10) unlocked.push({ achievementId: "play_10", unlockedAt: now });
  if (player.matches_played >= 20) unlocked.push({ achievementId: "play_20", unlockedAt: now });
  if (player.matches_played >= 50) unlocked.push({ achievementId: "play_50", unlockedAt: now });
  if (player.matches_played >= 100) unlocked.push({ achievementId: "play_100", unlockedAt: now });
  if (player.matches_played >= 200) unlocked.push({ achievementId: "play_200", unlockedAt: now });

  const weekdays = new Set(
    playerMatches.map((m) => new Date(m.created_at).getUTCDay()),
  );
  if (weekdays.size === 7) {
    unlocked.push({ achievementId: "all_weekdays", unlockedAt: now });
  }

  const dayBuckets = new Map<string, number>();
  for (const m of playerMatches) {
    const day = m.created_at.slice(0, 10);
    dayBuckets.set(day, (dayBuckets.get(day) ?? 0) + 1);
  }
  if ([...dayBuckets.values()].some((count) => count >= 3)) {
    unlocked.push({ achievementId: "triple_day", unlockedAt: now });
  }

  // triple_win_day: 3+ wins on any single UTC calendar day
  const dayWinBuckets = new Map<string, number>();
  for (const m of playerMatches) {
    const playerInA = m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
    const won = (playerInA && m.winning_team === "A") || (!playerInA && m.winning_team === "B");
    if (won) {
      const day = m.created_at.slice(0, 10);
      dayWinBuckets.set(day, (dayWinBuckets.get(day) ?? 0) + 1);
    }
  }
  if ([...dayWinBuckets.values()].some((count) => count >= 3)) {
    unlocked.push({ achievementId: "triple_win_day", unlockedAt: now });
  }

  const teammateCounts = computeTeammateCounts(playerId, matches);
  let bestPartnerId: string | null = null;
  let bestPartnerCount = 0;
  for (const [pid, count] of teammateCounts) {
    if (count > bestPartnerCount) {
      bestPartnerCount = count;
      bestPartnerId = pid;
    }
  }
  if (bestPartnerId && bestPartnerCount >= 10) {
    unlocked.push({
      achievementId: "best_friend",
      unlockedAt: now,
      meta: { partnerId: bestPartnerId, count: bestPartnerCount },
    });
  }
  if (bestPartnerId && bestPartnerCount >= 20) {
    unlocked.push({
      achievementId: "bff",
      unlockedAt: now,
      meta: { partnerId: bestPartnerId, count: bestPartnerCount },
    });
  }

  const opponentCounts = computeOpponentCounts(playerId, matches);
  let topEnemyId: string | null = null;
  let topEnemyCount = 0;
  for (const [pid, count] of opponentCounts) {
    if (count > topEnemyCount) {
      topEnemyCount = count;
      topEnemyId = pid;
    }
  }
  if (topEnemyId && topEnemyCount >= 10) {
    unlocked.push({
      achievementId: "sworn_enemies",
      unlockedAt: now,
      meta: { opponentId: topEnemyId, count: topEnemyCount },
    });
  }
  if (topEnemyId && topEnemyCount >= 20) {
    unlocked.push({
      achievementId: "arch_nemesis",
      unlockedAt: now,
      meta: { opponentId: topEnemyId, count: topEnemyCount },
    });
  }

  // achievement_hunter: must be last — counts all other unlocked achievements
  if (unlocked.length >= 10) {
    unlocked.push({ achievementId: "achievement_hunter", unlockedAt: now });
  }

  return unlocked;
}

// ---------------------------------------------------------------------------
// Exported: recompute + upsert all achievements for all players
// ---------------------------------------------------------------------------

export async function recomputeAllAchievements(
  supabase: SupabaseClient,
  players: Player[],
  matches: Match[],
): Promise<void> {
  const rows: {
    player_id: string;
    achievement_id: AchievementId;
    unlocked_at: string;
    meta: Record<string, unknown> | null;
  }[] = [];

  for (const player of players) {
    const unlocked = computeAchievementsForPlayer(player.id, player, matches);
    for (const u of unlocked) {
      rows.push({
        player_id: player.id,
        achievement_id: u.achievementId,
        unlocked_at: u.unlockedAt.toISOString(),
        meta: u.meta ?? null,
      });
    }
  }

  if (rows.length === 0) return;

  const { error } = await supabase.from("player_achievements").upsert(rows, {
    onConflict: "player_id,achievement_id",
    ignoreDuplicates: true,
  });

  if (error) throw error;
}
