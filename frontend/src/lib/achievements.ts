import type { SupabaseClient } from "@supabase/supabase-js";
import type { Player, Match } from "./supabase";

// ---------------------------------------------------------------------------
// Types
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

export type RarityTier = "legendary" | "rare" | "uncommon" | "common";

export interface AchievementDefinition {
  id: AchievementId;
  icon: string;
  name: string;
  description: string;
}

export interface UnlockedAchievement {
  achievementId: AchievementId;
  unlockedAt: Date;
  meta?: Record<string, unknown>;
}

export interface AchievementStatus {
  definition: AchievementDefinition;
  unlocked: boolean;
  unlockedAt?: Date;
  meta?: Record<string, unknown>;
  rarityPercent?: number;
  rarityTier?: RarityTier;
}

export interface PlayerAchievementRow {
  id: string;
  player_id: string;
  achievement_id: AchievementId;
  unlocked_at: string;
  meta: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  {
    id: "win_1",
    icon: "🥇",
    name: "First Victory",
    description: "Win your first match",
  },
  {
    id: "win_5",
    icon: "🎯",
    name: "Five-Win Club",
    description: "Win 5 matches over your career",
  },
  {
    id: "win_10",
    icon: "🏆",
    name: "Ten Wins",
    description: "Win 10 matches",
  },
  {
    id: "win_20",
    icon: "🌟",
    name: "Twenty Wins",
    description: "Win 20 matches",
  },
  {
    id: "win_50",
    icon: "👑",
    name: "Champion",
    description: "Win 50 matches",
  },
  {
    id: "lose_1",
    icon: "😅",
    name: "First Defeat",
    description: "Lose your first match",
  },
  {
    id: "lose_5",
    icon: "💀",
    name: "Battle-Hardened",
    description: "Lose 5 matches — every champion knows defeat",
  },
  {
    id: "lose_10",
    icon: "😤",
    name: "Resilient",
    description: "Lose 10 matches",
  },
  {
    id: "lose_20",
    icon: "💪",
    name: "Never Give Up",
    description: "Lose 20 matches",
  },
  {
    id: "lose_50",
    icon: "🧱",
    name: "Iron Will",
    description: "Lose 50 matches — still standing",
  },
  {
    id: "play_10",
    icon: "🎮",
    name: "Getting Started",
    description: "Play 10 total matches",
  },
  {
    id: "play_20",
    icon: "🕹️",
    name: "Committed Player",
    description: "Play 20 total matches",
  },
  {
    id: "play_50",
    icon: "🎰",
    name: "Dedicated",
    description: "Play 50 total matches",
  },
  {
    id: "play_100",
    icon: "💯",
    name: "Centurion",
    description: "Play 100 total matches",
  },
  {
    id: "play_200",
    icon: "🚀",
    name: "Legend",
    description: "Play 200 total matches",
  },
  {
    id: "all_weekdays",
    icon: "📅",
    name: "Week Warrior",
    description: "Play at least one match on every day of the week",
  },
  {
    id: "triple_day",
    icon: "⚡",
    name: "Hattrick Day",
    description: "Play 3 or more matches in a single calendar day",
  },
  {
    id: "triple_win_day",
    icon: "🔥",
    name: "Dominant Day",
    description: "Win 3 or more matches in a single calendar day",
  },
  {
    id: "best_friend",
    icon: "🤝",
    name: "Best Friend",
    description: "Play 10+ matches on the same team as one partner",
  },
  {
    id: "bff",
    icon: "💞",
    name: "BFF",
    description: "Play 20+ matches on the same team as one partner",
  },
  {
    id: "sworn_enemies",
    icon: "⚔️",
    name: "Sworn Enemies",
    description: "Face the same opponent in 10+ matches",
  },
  {
    id: "arch_nemesis",
    icon: "💀⚔️",
    name: "Arch Nemesis",
    description: "Face the same opponent in 20+ matches",
  },
  {
    id: "achievement_hunter",
    icon: "🎖️",
    name: "Achievement Hunter",
    description: "Unlock 10 achievements",
  },
];

export const RARITY_TIERS: {
  tier: RarityTier;
  maxPercent: number;
  color: string;
  label: string;
}[] = [
  { tier: "legendary", maxPercent: 10, color: "#f97316", label: "Legendary" },
  { tier: "rare", maxPercent: 25, color: "#a855f7", label: "Rare" },
  { tier: "uncommon", maxPercent: 50, color: "#22c55e", label: "Uncommon" },
  { tier: "common", maxPercent: 100, color: "#6b7280", label: "Common" },
];

// ---------------------------------------------------------------------------
// Shared helpers (also used by PlayerDetail)
// ---------------------------------------------------------------------------

/** Count how many matches `playerId` played on the same team as each partner. */
export function computeTeammateCounts(
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

/** Count total matches `playerId` played against each opponent. */
export function computeOpponentCounts(
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

// ---------------------------------------------------------------------------
// Core: compute achievements for one player (pure, no network calls)
// ---------------------------------------------------------------------------

export function computeAchievementsForPlayer(
  playerId: string,
  player: Player,
  matches: Match[],
): UnlockedAchievement[] {
  const now = new Date();
  const unlocked: UnlockedAchievement[] = [];

  // Filter matches involving this player
  const playerMatches = matches.filter(
    (m) =>
      m.team_a_player_1_id === playerId ||
      m.team_a_player_2_id === playerId ||
      m.team_b_player_1_id === playerId ||
      m.team_b_player_2_id === playerId,
  );

  // win milestones
  if (player.wins >= 1)
    unlocked.push({ achievementId: "win_1", unlockedAt: now });
  if (player.wins >= 5)
    unlocked.push({ achievementId: "win_5", unlockedAt: now });
  if (player.wins >= 10)
    unlocked.push({ achievementId: "win_10", unlockedAt: now });
  if (player.wins >= 20)
    unlocked.push({ achievementId: "win_20", unlockedAt: now });
  if (player.wins >= 50)
    unlocked.push({ achievementId: "win_50", unlockedAt: now });

  // lose milestones
  if (player.losses >= 1)
    unlocked.push({ achievementId: "lose_1", unlockedAt: now });
  if (player.losses >= 5)
    unlocked.push({ achievementId: "lose_5", unlockedAt: now });
  if (player.losses >= 10)
    unlocked.push({ achievementId: "lose_10", unlockedAt: now });
  if (player.losses >= 20)
    unlocked.push({ achievementId: "lose_20", unlockedAt: now });
  if (player.losses >= 50)
    unlocked.push({ achievementId: "lose_50", unlockedAt: now });

  // play milestones
  if (player.matches_played >= 10)
    unlocked.push({ achievementId: "play_10", unlockedAt: now });
  if (player.matches_played >= 20)
    unlocked.push({ achievementId: "play_20", unlockedAt: now });
  if (player.matches_played >= 50)
    unlocked.push({ achievementId: "play_50", unlockedAt: now });
  if (player.matches_played >= 100)
    unlocked.push({ achievementId: "play_100", unlockedAt: now });
  if (player.matches_played >= 200)
    unlocked.push({ achievementId: "play_200", unlockedAt: now });

  // all_weekdays: played on all 7 days of the week (UTC)
  const weekdays = new Set(
    playerMatches.map((m) => new Date(m.created_at).getUTCDay()),
  );
  if (weekdays.size === 7) {
    unlocked.push({ achievementId: "all_weekdays", unlockedAt: now });
  }

  // triple_day: 3+ matches on any single UTC calendar day
  const dayBuckets = new Map<string, number>();
  for (const m of playerMatches) {
    const day = m.created_at.slice(0, 10); // "YYYY-MM-DD" UTC
    dayBuckets.set(day, (dayBuckets.get(day) ?? 0) + 1);
  }
  if ([...dayBuckets.values()].some((count) => count >= 3)) {
    unlocked.push({ achievementId: "triple_day", unlockedAt: now });
  }

  // triple_win_day: 3+ wins on any single UTC calendar day
  const dayWinBuckets = new Map<string, number>();
  for (const m of playerMatches) {
    const playerInA =
      m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
    const won =
      (playerInA && m.winning_team === "A") ||
      (!playerInA && m.winning_team === "B");
    if (won) {
      const day = m.created_at.slice(0, 10);
      dayWinBuckets.set(day, (dayWinBuckets.get(day) ?? 0) + 1);
    }
  }
  if ([...dayWinBuckets.values()].some((count) => count >= 3)) {
    unlocked.push({ achievementId: "triple_win_day", unlockedAt: now });
  }

  // best_friend: 10+ matches with one specific teammate
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

  // sworn_enemies / arch_nemesis: 10+/20+ matches against one specific opponent
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
// Rarity helpers
// ---------------------------------------------------------------------------

export function computeRarityMap(
  allRows: PlayerAchievementRow[],
  totalPlayers: number,
): Map<AchievementId, number> {
  const countMap = new Map<AchievementId, number>();
  for (const row of allRows) {
    countMap.set(
      row.achievement_id,
      (countMap.get(row.achievement_id) ?? 0) + 1,
    );
  }
  const rarityMap = new Map<AchievementId, number>();
  for (const [id, count] of countMap) {
    rarityMap.set(id, totalPlayers > 0 ? (count / totalPlayers) * 100 : 0);
  }
  return rarityMap;
}

export function rarityTierForPercent(percent: number): RarityTier {
  for (const { tier, maxPercent } of RARITY_TIERS) {
    if (percent <= maxPercent) return tier;
  }
  return "common";
}

export function rarityColorForTier(tier: RarityTier): string {
  return RARITY_TIERS.find((r) => r.tier === tier)?.color ?? "#6b7280";
}

/** Compute rarity purely from match/player data — used when the DB table is empty. */
export function computeClientSideRarityMap(
  allPlayers: Player[],
  matches: Match[],
): Map<AchievementId, number> {
  const countMap = new Map<AchievementId, number>();
  for (const player of allPlayers) {
    for (const { achievementId } of computeAchievementsForPlayer(
      player.id,
      player,
      matches,
    )) {
      countMap.set(achievementId, (countMap.get(achievementId) ?? 0) + 1);
    }
  }
  const rarityMap = new Map<AchievementId, number>();
  for (const [id, count] of countMap) {
    rarityMap.set(
      id,
      allPlayers.length > 0 ? (count / allPlayers.length) * 100 : 0,
    );
  }
  return rarityMap;
}

// ---------------------------------------------------------------------------
// Build display statuses (unlocked list + rarity → AchievementStatus[])
// ---------------------------------------------------------------------------

export function buildAchievementStatuses(
  playerId: string,
  player: Player,
  allPlayers: Player[],
  matches: Match[],
  allRows: PlayerAchievementRow[],
): AchievementStatus[] {
  const rarityMap =
    allRows.length > 0
      ? computeRarityMap(allRows, allPlayers.length)
      : computeClientSideRarityMap(allPlayers, matches);

  // Use DB rows as the source of truth for unlocked state; fall back to live
  // computation if the player has no rows yet (e.g. brand-new player).
  const playerRows = allRows.filter((r) => r.player_id === playerId);
  const unlockedIds = new Set(playerRows.map((r) => r.achievement_id));

  // If no DB rows at all for this player, compute client-side
  const liveUnlocked =
    playerRows.length === 0
      ? computeAchievementsForPlayer(playerId, player, matches)
      : [];

  for (const u of liveUnlocked) {
    unlockedIds.add(u.achievementId);
  }

  return ACHIEVEMENT_DEFINITIONS.map((def) => {
    const row = playerRows.find((r) => r.achievement_id === def.id);
    const liveEntry = liveUnlocked.find((u) => u.achievementId === def.id);
    const unlocked = unlockedIds.has(def.id);
    const rarityPercent = rarityMap.get(def.id);
    const rarityTier =
      rarityPercent !== undefined
        ? rarityTierForPercent(rarityPercent)
        : undefined;

    return {
      definition: def,
      unlocked,
      unlockedAt: row ? new Date(row.unlocked_at) : liveEntry?.unlockedAt,
      meta: row?.meta ?? liveEntry?.meta,
      rarityPercent,
      rarityTier,
    };
  });
}

// ---------------------------------------------------------------------------
// Recompute + upsert all achievements for all players
// (used by the edge function; also callable from browser with anon key for
//  own-player updates, or with service-role key for full recompute)
// ---------------------------------------------------------------------------

export async function recomputeAllAchievements(
  supabase: SupabaseClient,
  players: Player[],
  matches: Match[],
): Promise<void> {
  const rows: Omit<PlayerAchievementRow, "id">[] = [];

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
