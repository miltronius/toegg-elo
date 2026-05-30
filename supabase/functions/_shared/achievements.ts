// Deno-compatible version of frontend/src/lib/achievements.ts
// No browser-specific imports. Used by the calculate-elo edge function.

import type { SupabaseClient } from "@supabase/supabase-js";

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
  | "achievement_hunter"
  | "streak_win_3"
  | "streak_win_5"
  | "streak_win_7"
  | "streak_win_10"
  | "streak_loss_3"
  | "streak_loss_5"
  | "comeback_kid"
  | "punching_bag"
  | "teams_1"
  | "teams_3"
  | "teams_10"
  | "world_tour"
  | "nemesis_of_all"
  | "to_the_moon"
  | "rock_bottom"
  | "carrying_hard"
  | "deadweight"
  | "completionist";

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

interface EloHistory {
  id: string;
  player_id: string;
  match_id: string | null;
  season_id: string | null;
  elo_before: number;
  elo_after: number;
  elo_change: number;
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
  _player: Player,
  matches: Match[],
  allPlayers: Player[] = [],
  eloHistory: EloHistory[] = [],
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
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  // Separate wins and losses in chronological order
  const winMatches: Match[] = [];
  const lossMatches: Match[] = [];
  for (const m of sorted) {
    const inA = m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
    const won = (inA && m.winning_team === "A") || (!inA && m.winning_team === "B");
    if (won) winMatches.push(m); else lossMatches.push(m);
  }

  // win milestones — unlockedAt = date of the Nth win
  if (winMatches.length >= 1) unlocked.push({ achievementId: "win_1", unlockedAt: new Date(winMatches[0].created_at) });
  if (winMatches.length >= 5) unlocked.push({ achievementId: "win_5", unlockedAt: new Date(winMatches[4].created_at) });
  if (winMatches.length >= 10) unlocked.push({ achievementId: "win_10", unlockedAt: new Date(winMatches[9].created_at) });
  if (winMatches.length >= 20) unlocked.push({ achievementId: "win_20", unlockedAt: new Date(winMatches[19].created_at) });
  if (winMatches.length >= 50) unlocked.push({ achievementId: "win_50", unlockedAt: new Date(winMatches[49].created_at) });

  // lose milestones — unlockedAt = date of the Nth loss
  if (lossMatches.length >= 1) unlocked.push({ achievementId: "lose_1", unlockedAt: new Date(lossMatches[0].created_at) });
  if (lossMatches.length >= 5) unlocked.push({ achievementId: "lose_5", unlockedAt: new Date(lossMatches[4].created_at) });
  if (lossMatches.length >= 10) unlocked.push({ achievementId: "lose_10", unlockedAt: new Date(lossMatches[9].created_at) });
  if (lossMatches.length >= 20) unlocked.push({ achievementId: "lose_20", unlockedAt: new Date(lossMatches[19].created_at) });
  if (lossMatches.length >= 50) unlocked.push({ achievementId: "lose_50", unlockedAt: new Date(lossMatches[49].created_at) });

  // play milestones — unlockedAt = date of the Nth match
  if (sorted.length >= 10) unlocked.push({ achievementId: "play_10", unlockedAt: new Date(sorted[9].created_at) });
  if (sorted.length >= 20) unlocked.push({ achievementId: "play_20", unlockedAt: new Date(sorted[19].created_at) });
  if (sorted.length >= 50) unlocked.push({ achievementId: "play_50", unlockedAt: new Date(sorted[49].created_at) });
  if (sorted.length >= 100) unlocked.push({ achievementId: "play_100", unlockedAt: new Date(sorted[99].created_at) });
  if (sorted.length >= 200) unlocked.push({ achievementId: "play_200", unlockedAt: new Date(sorted[199].created_at) });

  // all_weekdays — unlockedAt = date of the match that completed all 5 workdays (Mon–Fri)
  // getUTCDay(): 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const seenWorkdays = new Set<number>();
  for (const m of sorted) {
    const day = new Date(m.created_at).getUTCDay();
    if (day >= 1 && day <= 5) {
      seenWorkdays.add(day);
      if (seenWorkdays.size === 5) {
        unlocked.push({ achievementId: "all_weekdays", unlockedAt: new Date(m.created_at) });
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
      unlocked.push({ achievementId: "triple_day", unlockedAt: new Date(m.created_at) });
      break;
    }
  }

  // triple_win_day — unlockedAt = date of the 3rd win on the qualifying day
  const dayWinCounts = new Map<string, number>();
  for (const m of sorted) {
    const inA = m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
    const won = (inA && m.winning_team === "A") || (!inA && m.winning_team === "B");
    if (won) {
      const day = m.created_at.slice(0, 10);
      const count = (dayWinCounts.get(day) ?? 0) + 1;
      dayWinCounts.set(day, count);
      if (count === 3) {
        unlocked.push({ achievementId: "triple_win_day", unlockedAt: new Date(m.created_at) });
        break;
      }
    }
  }

  // best_friend / bff — unlockedAt = date of the 10th/20th match with that partner
  const teammateCounts = computeTeammateCounts(playerId, matches);
  let bestPartnerId: string | null = null;
  let bestPartnerCount = 0;
  for (const [pid, count] of teammateCounts) {
    if (count > bestPartnerCount) { bestPartnerCount = count; bestPartnerId = pid; }
  }
  if (bestPartnerId && bestPartnerCount >= 10) {
    let c = 0;
    for (const m of sorted) {
      const inA = m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
      const t1 = inA ? m.team_a_player_1_id : m.team_b_player_1_id;
      const t2 = inA ? m.team_a_player_2_id : m.team_b_player_2_id;
      if (t1 === bestPartnerId || t2 === bestPartnerId) {
        if (++c === 10) {
          unlocked.push({ achievementId: "best_friend", unlockedAt: new Date(m.created_at), meta: { partnerId: bestPartnerId, count: bestPartnerCount } });
          break;
        }
      }
    }
  }
  if (bestPartnerId && bestPartnerCount >= 20) {
    let c = 0;
    for (const m of sorted) {
      const inA = m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
      const t1 = inA ? m.team_a_player_1_id : m.team_b_player_1_id;
      const t2 = inA ? m.team_a_player_2_id : m.team_b_player_2_id;
      if (t1 === bestPartnerId || t2 === bestPartnerId) {
        if (++c === 20) {
          unlocked.push({ achievementId: "bff", unlockedAt: new Date(m.created_at), meta: { partnerId: bestPartnerId, count: bestPartnerCount } });
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
    if (count > topEnemyCount) { topEnemyCount = count; topEnemyId = pid; }
  }
  if (topEnemyId && topEnemyCount >= 10) {
    let c = 0;
    for (const m of sorted) {
      const inA = m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
      const o1 = inA ? m.team_b_player_1_id : m.team_a_player_1_id;
      const o2 = inA ? m.team_b_player_2_id : m.team_a_player_2_id;
      if (o1 === topEnemyId || o2 === topEnemyId) {
        if (++c === 10) {
          unlocked.push({ achievementId: "sworn_enemies", unlockedAt: new Date(m.created_at), meta: { opponentId: topEnemyId, count: topEnemyCount } });
          break;
        }
      }
    }
  }
  if (topEnemyId && topEnemyCount >= 20) {
    let c = 0;
    for (const m of sorted) {
      const inA = m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
      const o1 = inA ? m.team_b_player_1_id : m.team_a_player_1_id;
      const o2 = inA ? m.team_b_player_2_id : m.team_a_player_2_id;
      if (o1 === topEnemyId || o2 === topEnemyId) {
        if (++c === 20) {
          unlocked.push({ achievementId: "arch_nemesis", unlockedAt: new Date(m.created_at), meta: { opponentId: topEnemyId, count: topEnemyCount } });
          break;
        }
      }
    }
  }

  // win / loss streaks + comeback_kid — single chronological pass
  {
    let winStreak = 0;
    let lossStreak = 0;
    const winHit = new Set<number>();
    const lossHit = new Set<number>();
    let comebackDone = false;
    const winThresholds: [AchievementId, number][] = [
      ["streak_win_3", 3], ["streak_win_5", 5], ["streak_win_7", 7], ["streak_win_10", 10],
    ];
    const lossThresholds: [AchievementId, number][] = [
      ["streak_loss_3", 3], ["streak_loss_5", 5],
    ];
    for (const m of sorted) {
      const inA = m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
      const won = (inA && m.winning_team === "A") || (!inA && m.winning_team === "B");
      if (won) {
        if (!comebackDone && lossStreak >= 3) {
          unlocked.push({ achievementId: "comeback_kid", unlockedAt: new Date(m.created_at) });
          comebackDone = true;
        }
        lossStreak = 0;
        winStreak++;
        for (const [id, n] of winThresholds) {
          if (winStreak === n && !winHit.has(n)) {
            winHit.add(n);
            unlocked.push({ achievementId: id, unlockedAt: new Date(m.created_at) });
          }
        }
      } else {
        winStreak = 0;
        lossStreak++;
        for (const [id, n] of lossThresholds) {
          if (lossStreak === n && !lossHit.has(n)) {
            lossHit.add(n);
            unlocked.push({ achievementId: id, unlockedAt: new Date(m.created_at) });
          }
        }
      }
    }
  }

  // punching_bag — 3 consecutive wins vs the same opponent (last 3 meetings)
  {
    const consecWins = new Map<string, number>();
    let done = false;
    for (const m of sorted) {
      if (done) break;
      const inA = m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
      const won = (inA && m.winning_team === "A") || (!inA && m.winning_team === "B");
      const opponents = inA
        ? [m.team_b_player_1_id, m.team_b_player_2_id]
        : [m.team_a_player_1_id, m.team_a_player_2_id];
      for (const oppId of opponents) {
        const next = won ? (consecWins.get(oppId) ?? 0) + 1 : 0;
        consecWins.set(oppId, next);
        if (next === 3 && !done) {
          unlocked.push({ achievementId: "punching_bag", unlockedAt: new Date(m.created_at), meta: { opponentId: oppId } });
          done = true;
        }
      }
    }
  }

  // teams_1 / teams_3 / teams_10 — distinct partners over time
  {
    const partners = new Set<string>();
    const hit = new Set<number>();
    const thresholds: [AchievementId, number][] = [
      ["teams_1", 1], ["teams_3", 3], ["teams_10", 10],
    ];
    for (const m of sorted) {
      const inA = m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
      const partner = inA
        ? (m.team_a_player_1_id === playerId ? m.team_a_player_2_id : m.team_a_player_1_id)
        : (m.team_b_player_1_id === playerId ? m.team_b_player_2_id : m.team_b_player_1_id);
      partners.add(partner);
      for (const [id, n] of thresholds) {
        if (partners.size >= n && !hit.has(n)) {
          hit.add(n);
          unlocked.push({ achievementId: id, unlockedAt: new Date(m.created_at) });
        }
      }
    }
  }

  // world_tour / nemesis_of_all — breadth across the roster (>= 4 players)
  if (allPlayers.length >= 4) {
    const others = new Set(allPlayers.map((p) => p.id).filter((id) => id !== playerId));
    const faced = new Set<string>();
    const beaten = new Set<string>();
    let worldTourDone = false;
    let nemesisDone = false;
    for (const m of sorted) {
      if (worldTourDone && nemesisDone) break;
      const inA = m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
      const won = (inA && m.winning_team === "A") || (!inA && m.winning_team === "B");
      const opponents = inA
        ? [m.team_b_player_1_id, m.team_b_player_2_id]
        : [m.team_a_player_1_id, m.team_a_player_2_id];
      for (const oppId of opponents) {
        if (!others.has(oppId)) continue;
        faced.add(oppId);
        if (won) beaten.add(oppId);
      }
      if (!worldTourDone && faced.size === others.size) {
        unlocked.push({ achievementId: "world_tour", unlockedAt: new Date(m.created_at) });
        worldTourDone = true;
      }
      if (!nemesisDone && beaten.size === others.size) {
        unlocked.push({ achievementId: "nemesis_of_all", unlockedAt: new Date(m.created_at) });
        nemesisDone = true;
      }
    }
  }

  // to_the_moon / rock_bottom — net ELO change within a single calendar day
  {
    const playerHistory = eloHistory
      .filter((h) => h.player_id === playerId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const dayDelta = new Map<string, number>();
    let moonDone = false;
    let bottomDone = false;
    for (const h of playerHistory) {
      const day = h.created_at.slice(0, 10);
      const total = (dayDelta.get(day) ?? 0) + h.elo_change;
      dayDelta.set(day, total);
      if (!moonDone && total >= 100) {
        unlocked.push({ achievementId: "to_the_moon", unlockedAt: new Date(h.created_at) });
        moonDone = true;
      }
      if (!bottomDone && total <= -75) {
        unlocked.push({ achievementId: "rock_bottom", unlockedAt: new Date(h.created_at) });
        bottomDone = true;
      }
    }
  }

  // carrying_hard / deadweight — partner ELO gap (200+) on a won match
  {
    const eloBeforeByMatch = new Map<string, number>();
    for (const h of eloHistory) {
      if (h.match_id) eloBeforeByMatch.set(`${h.match_id}:${h.player_id}`, h.elo_before);
    }
    let carryDone = false;
    let deadweightDone = false;
    for (const m of sorted) {
      if (carryDone && deadweightDone) break;
      const inA = m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
      const won = (inA && m.winning_team === "A") || (!inA && m.winning_team === "B");
      if (!won) continue;
      const partnerId = inA
        ? (m.team_a_player_1_id === playerId ? m.team_a_player_2_id : m.team_a_player_1_id)
        : (m.team_b_player_1_id === playerId ? m.team_b_player_2_id : m.team_b_player_1_id);
      const myElo = eloBeforeByMatch.get(`${m.id}:${playerId}`);
      const partnerElo = eloBeforeByMatch.get(`${m.id}:${partnerId}`);
      if (myElo === undefined || partnerElo === undefined) continue;
      if (!carryDone && partnerElo <= myElo - 200) {
        unlocked.push({ achievementId: "carrying_hard", unlockedAt: new Date(m.created_at), meta: { partnerId } });
        carryDone = true;
      }
      if (!deadweightDone && partnerElo >= myElo + 200) {
        unlocked.push({ achievementId: "deadweight", unlockedAt: new Date(m.created_at), meta: { partnerId } });
        deadweightDone = true;
      }
    }
  }

  // achievement_hunter — unlockedAt = date the 10th achievement was earned
  if (unlocked.length >= 10) {
    const tenth = [...unlocked].sort((a, b) => a.unlockedAt.getTime() - b.unlockedAt.getTime())[9];
    unlocked.push({ achievementId: "achievement_hunter", unlockedAt: tenth.unlockedAt });
  }

  // completionist — unlockedAt = date the 20th achievement was earned
  if (unlocked.length >= 20) {
    const twentieth = [...unlocked].sort((a, b) => a.unlockedAt.getTime() - b.unlockedAt.getTime())[19];
    unlocked.push({ achievementId: "completionist", unlockedAt: twentieth.unlockedAt });
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

  // ELO history feeds the day-swing and partner-gap achievements.
  const { data: eloHistory } = await supabase.from("elo_history").select("*");
  const history = (eloHistory ?? []) as EloHistory[];

  for (const player of players) {
    const unlocked = computeAchievementsForPlayer(
      player.id,
      player,
      matches,
      players,
      history,
    );
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
