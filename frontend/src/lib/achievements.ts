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

export type RarityTier = "legendary" | "epic" | "rare" | "uncommon" | "common";

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
    description: "Play at least one match on every workday (Monday to Friday)",
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
  { tier: "legendary", maxPercent: 12, color: "#f97316", label: "Legendary" },
  { tier: "epic", maxPercent: 24, color: "#a855f7", label: "Epic" },
  { tier: "rare", maxPercent: 36, color: "#3b82f6", label: "Rare" },
  { tier: "uncommon", maxPercent: 60, color: "#22c55e", label: "Uncommon" },
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
  _player: Player,
  matches: Match[],
): UnlockedAchievement[] {
  const unlocked: UnlockedAchievement[] = [];

  const playerMatches = matches.filter(
    (m) =>
      m.team_a_player_1_id === playerId ||
      m.team_a_player_2_id === playerId ||
      m.team_b_player_1_id === playerId ||
      m.team_b_player_2_id === playerId,
  );

  // Sort ascending so we can find the exact match that crossed each threshold
  const sorted = [...playerMatches].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  // Separate wins and losses in chronological order
  const winMatches: Match[] = [];
  const lossMatches: Match[] = [];
  for (const m of sorted) {
    const inA =
      m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
    const won =
      (inA && m.winning_team === "A") || (!inA && m.winning_team === "B");
    if (won) winMatches.push(m);
    else lossMatches.push(m);
  }

  // win milestones — unlockedAt = date of the Nth win
  if (winMatches.length >= 1)
    unlocked.push({
      achievementId: "win_1",
      unlockedAt: new Date(winMatches[0].created_at),
    });
  if (winMatches.length >= 5)
    unlocked.push({
      achievementId: "win_5",
      unlockedAt: new Date(winMatches[4].created_at),
    });
  if (winMatches.length >= 10)
    unlocked.push({
      achievementId: "win_10",
      unlockedAt: new Date(winMatches[9].created_at),
    });
  if (winMatches.length >= 20)
    unlocked.push({
      achievementId: "win_20",
      unlockedAt: new Date(winMatches[19].created_at),
    });
  if (winMatches.length >= 50)
    unlocked.push({
      achievementId: "win_50",
      unlockedAt: new Date(winMatches[49].created_at),
    });

  // lose milestones — unlockedAt = date of the Nth loss
  if (lossMatches.length >= 1)
    unlocked.push({
      achievementId: "lose_1",
      unlockedAt: new Date(lossMatches[0].created_at),
    });
  if (lossMatches.length >= 5)
    unlocked.push({
      achievementId: "lose_5",
      unlockedAt: new Date(lossMatches[4].created_at),
    });
  if (lossMatches.length >= 10)
    unlocked.push({
      achievementId: "lose_10",
      unlockedAt: new Date(lossMatches[9].created_at),
    });
  if (lossMatches.length >= 20)
    unlocked.push({
      achievementId: "lose_20",
      unlockedAt: new Date(lossMatches[19].created_at),
    });
  if (lossMatches.length >= 50)
    unlocked.push({
      achievementId: "lose_50",
      unlockedAt: new Date(lossMatches[49].created_at),
    });

  // play milestones — unlockedAt = date of the Nth match
  if (sorted.length >= 10)
    unlocked.push({
      achievementId: "play_10",
      unlockedAt: new Date(sorted[9].created_at),
    });
  if (sorted.length >= 20)
    unlocked.push({
      achievementId: "play_20",
      unlockedAt: new Date(sorted[19].created_at),
    });
  if (sorted.length >= 50)
    unlocked.push({
      achievementId: "play_50",
      unlockedAt: new Date(sorted[49].created_at),
    });
  if (sorted.length >= 100)
    unlocked.push({
      achievementId: "play_100",
      unlockedAt: new Date(sorted[99].created_at),
    });
  if (sorted.length >= 200)
    unlocked.push({
      achievementId: "play_200",
      unlockedAt: new Date(sorted[199].created_at),
    });

  // all_weekdays — unlockedAt = date of the match that completed all 5 workdays (Mon–Fri)
  // getUTCDay(): 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const seenWorkdays = new Set<number>();
  for (const m of sorted) {
    const day = new Date(m.created_at).getUTCDay();
    if (day >= 1 && day <= 5) {
      seenWorkdays.add(day);
      if (seenWorkdays.size === 5) {
        unlocked.push({
          achievementId: "all_weekdays",
          unlockedAt: new Date(m.created_at),
        });
        break;
      }
    }
  }

  // triple_day — unlockedAt = date of the 3rd match on the qualifying day
  const dayCounts = new Map<string, number>();
  for (const m of sorted) {
    const day = m.created_at.slice(0, 10);
    const count = (dayCounts.get(day) ?? 0) + 1;
    dayCounts.set(day, count);
    if (count === 3) {
      unlocked.push({
        achievementId: "triple_day",
        unlockedAt: new Date(m.created_at),
      });
      break;
    }
  }

  // triple_win_day — unlockedAt = date of the 3rd win on the qualifying day
  const dayWinCounts = new Map<string, number>();
  for (const m of sorted) {
    const inA =
      m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
    const won =
      (inA && m.winning_team === "A") || (!inA && m.winning_team === "B");
    if (won) {
      const day = m.created_at.slice(0, 10);
      const count = (dayWinCounts.get(day) ?? 0) + 1;
      dayWinCounts.set(day, count);
      if (count === 3) {
        unlocked.push({
          achievementId: "triple_win_day",
          unlockedAt: new Date(m.created_at),
        });
        break;
      }
    }
  }

  // best_friend / bff — unlockedAt = date of the 10th/20th match with that partner
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
    let c = 0;
    for (const m of sorted) {
      const inA =
        m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
      const t1 = inA ? m.team_a_player_1_id : m.team_b_player_1_id;
      const t2 = inA ? m.team_a_player_2_id : m.team_b_player_2_id;
      if (t1 === bestPartnerId || t2 === bestPartnerId) {
        if (++c === 10) {
          unlocked.push({
            achievementId: "best_friend",
            unlockedAt: new Date(m.created_at),
            meta: { partnerId: bestPartnerId, count: bestPartnerCount },
          });
          break;
        }
      }
    }
  }
  if (bestPartnerId && bestPartnerCount >= 20) {
    let c = 0;
    for (const m of sorted) {
      const inA =
        m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
      const t1 = inA ? m.team_a_player_1_id : m.team_b_player_1_id;
      const t2 = inA ? m.team_a_player_2_id : m.team_b_player_2_id;
      if (t1 === bestPartnerId || t2 === bestPartnerId) {
        if (++c === 20) {
          unlocked.push({
            achievementId: "bff",
            unlockedAt: new Date(m.created_at),
            meta: { partnerId: bestPartnerId, count: bestPartnerCount },
          });
          break;
        }
      }
    }
  }

  // sworn_enemies / arch_nemesis — unlockedAt = date of the 10th/20th match vs that opponent
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
    let c = 0;
    for (const m of sorted) {
      const inA =
        m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
      const o1 = inA ? m.team_b_player_1_id : m.team_a_player_1_id;
      const o2 = inA ? m.team_b_player_2_id : m.team_a_player_2_id;
      if (o1 === topEnemyId || o2 === topEnemyId) {
        if (++c === 10) {
          unlocked.push({
            achievementId: "sworn_enemies",
            unlockedAt: new Date(m.created_at),
            meta: { opponentId: topEnemyId, count: topEnemyCount },
          });
          break;
        }
      }
    }
  }
  if (topEnemyId && topEnemyCount >= 20) {
    let c = 0;
    for (const m of sorted) {
      const inA =
        m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
      const o1 = inA ? m.team_b_player_1_id : m.team_a_player_1_id;
      const o2 = inA ? m.team_b_player_2_id : m.team_a_player_2_id;
      if (o1 === topEnemyId || o2 === topEnemyId) {
        if (++c === 20) {
          unlocked.push({
            achievementId: "arch_nemesis",
            unlockedAt: new Date(m.created_at),
            meta: { opponentId: topEnemyId, count: topEnemyCount },
          });
          break;
        }
      }
    }
  }

  // achievement_hunter — unlockedAt = date the 10th achievement was earned
  if (unlocked.length >= 10) {
    const tenth = [...unlocked].sort(
      (a, b) => a.unlockedAt.getTime() - b.unlockedAt.getTime(),
    )[9];
    unlocked.push({
      achievementId: "achievement_hunter",
      unlockedAt: tenth.unlockedAt,
    });
  }

  return unlocked;
}

// ---------------------------------------------------------------------------
// Next-achievement progress
// ---------------------------------------------------------------------------

export interface AchievementProgress {
  achievementId: AchievementId;
  current: number;
  target: number;
}

export function computeAchievementProgress(
  playerId: string,
  matches: Match[],
  unlockedIds: Set<AchievementId>,
): AchievementProgress[] {
  const progress: AchievementProgress[] = [];

  const playerMatches = matches.filter(
    (m) =>
      m.team_a_player_1_id === playerId ||
      m.team_a_player_2_id === playerId ||
      m.team_b_player_1_id === playerId ||
      m.team_b_player_2_id === playerId,
  );

  let wins = 0;
  for (const m of playerMatches) {
    const inA = m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
    if ((inA && m.winning_team === "A") || (!inA && m.winning_team === "B")) wins++;
  }
  const losses = playerMatches.length - wins;

  // Win chain — show only next unmet milestone
  for (const [id, target] of [
    ["win_1", 1], ["win_5", 5], ["win_10", 10], ["win_20", 20], ["win_50", 50],
  ] as [AchievementId, number][]) {
    if (!unlockedIds.has(id)) { progress.push({ achievementId: id, current: wins, target }); break; }
  }

  // Loss chain
  for (const [id, target] of [
    ["lose_1", 1], ["lose_5", 5], ["lose_10", 10], ["lose_20", 20], ["lose_50", 50],
  ] as [AchievementId, number][]) {
    if (!unlockedIds.has(id)) { progress.push({ achievementId: id, current: losses, target }); break; }
  }

  // Play chain
  for (const [id, target] of [
    ["play_10", 10], ["play_20", 20], ["play_50", 50], ["play_100", 100], ["play_200", 200],
  ] as [AchievementId, number][]) {
    if (!unlockedIds.has(id)) { progress.push({ achievementId: id, current: playerMatches.length, target }); break; }
  }

  // all_weekdays
  if (!unlockedIds.has("all_weekdays")) {
    const workdays = new Set(
      playerMatches.map((m) => new Date(m.created_at).getUTCDay()).filter((d) => d >= 1 && d <= 5),
    );
    progress.push({ achievementId: "all_weekdays", current: workdays.size, target: 5 });
  }

  // triple_day
  if (!unlockedIds.has("triple_day")) {
    const dayCounts = new Map<string, number>();
    for (const m of playerMatches) {
      const d = m.created_at.slice(0, 10);
      dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
    }
    const max = dayCounts.size > 0 ? Math.max(...dayCounts.values()) : 0;
    progress.push({ achievementId: "triple_day", current: max, target: 3 });
  }

  // triple_win_day
  if (!unlockedIds.has("triple_win_day")) {
    const dayWins = new Map<string, number>();
    for (const m of playerMatches) {
      const inA = m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
      if ((inA && m.winning_team === "A") || (!inA && m.winning_team === "B")) {
        const d = m.created_at.slice(0, 10);
        dayWins.set(d, (dayWins.get(d) ?? 0) + 1);
      }
    }
    const max = dayWins.size > 0 ? Math.max(...dayWins.values()) : 0;
    progress.push({ achievementId: "triple_win_day", current: max, target: 3 });
  }

  // best_friend / bff
  const teammateCounts = computeTeammateCounts(playerId, matches);
  const maxTeammate = teammateCounts.size > 0 ? Math.max(...teammateCounts.values()) : 0;
  if (!unlockedIds.has("best_friend")) {
    progress.push({ achievementId: "best_friend", current: maxTeammate, target: 10 });
  } else if (!unlockedIds.has("bff")) {
    progress.push({ achievementId: "bff", current: maxTeammate, target: 20 });
  }

  // sworn_enemies / arch_nemesis
  const opponentCounts = computeOpponentCounts(playerId, matches);
  const maxOpponent = opponentCounts.size > 0 ? Math.max(...opponentCounts.values()) : 0;
  if (!unlockedIds.has("sworn_enemies")) {
    progress.push({ achievementId: "sworn_enemies", current: maxOpponent, target: 10 });
  } else if (!unlockedIds.has("arch_nemesis")) {
    progress.push({ achievementId: "arch_nemesis", current: maxOpponent, target: 20 });
  }

  // achievement_hunter
  if (!unlockedIds.has("achievement_hunter")) {
    progress.push({ achievementId: "achievement_hunter", current: unlockedIds.size, target: 10 });
  }

  return progress.sort((a, b) => b.current / b.target - a.current / a.target);
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
