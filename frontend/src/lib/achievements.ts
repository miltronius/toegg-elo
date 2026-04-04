import type { SupabaseClient } from "@supabase/supabase-js";
import type { Player, Match } from "./supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AchievementId =
  | "win_5"
  | "lose_5"
  | "play_20"
  | "all_weekdays"
  | "triple_day"
  | "best_friend"
  | "sworn_enemies";

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
    id: "win_5",
    icon: "🎯",
    name: "Five-Win Club",
    description: "Win 5 matches over your career",
  },
  {
    id: "lose_5",
    icon: "💀",
    name: "Battle-Hardened",
    description: "Lose 5 matches — every champion knows defeat",
  },
  {
    id: "play_20",
    icon: "🎮",
    name: "Committed Player",
    description: "Play 20 total matches",
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
    name: "Hat-Trick Day",
    description: "Play 3 or more matches in a single calendar day",
  },
  {
    id: "best_friend",
    icon: "🤝",
    name: "Best Friend",
    description: "Play 10+ matches on the same team as one partner",
  },
  {
    id: "sworn_enemies",
    icon: "⚔️",
    name: "Sworn Enemies",
    description: "Face the same opponent in 10+ matches",
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

  // win_5
  if (player.wins >= 5) {
    unlocked.push({ achievementId: "win_5", unlockedAt: now });
  }

  // lose_5
  if (player.losses >= 5) {
    unlocked.push({ achievementId: "lose_5", unlockedAt: now });
  }

  // play_20
  if (player.matches_played >= 20) {
    unlocked.push({ achievementId: "play_20", unlockedAt: now });
  }

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

  // sworn_enemies: 10+ matches against one specific opponent
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
    rarityMap.set(
      id,
      totalPlayers > 0 ? (count / totalPlayers) * 100 : 0,
    );
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
    for (const { achievementId } of computeAchievementsForPlayer(player.id, player, matches)) {
      countMap.set(achievementId, (countMap.get(achievementId) ?? 0) + 1);
    }
  }
  const rarityMap = new Map<AchievementId, number>();
  for (const [id, count] of countMap) {
    rarityMap.set(id, allPlayers.length > 0 ? (count / allPlayers.length) * 100 : 0);
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
  const rarityMap = allRows.length > 0
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
      unlockedAt: row
        ? new Date(row.unlocked_at)
        : liveEntry?.unlockedAt,
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
    ignoreDuplicates: false,
  });

  if (error) throw error;
}
