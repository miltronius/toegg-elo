import { Match, Player } from "./supabase";
import { TeamNameRow } from "./supabase";

export type TeamStats = {
  key: string;
  player_id_lo: string;
  player_id_hi: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  combinedElo: number;
  nameRow: TeamNameRow | null;
  rivals: { key: string; matchesPlayed: number; wins: number; losses: number }[];
};

export function teamKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
}

export function teamKeyParts(key: string): [string, string] {
  const idx = key.indexOf(":");
  return [key.slice(0, idx), key.slice(idx + 1)];
}

export function computeTeamStats(
  matches: Match[],
  players: Player[],
  teamNames: TeamNameRow[],
): TeamStats[] {
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const nameMap = new Map(
    teamNames.map((r) => [teamKey(r.player_id_lo, r.player_id_hi), r]),
  );

  type Acc = {
    lo: string;
    hi: string;
    wins: number;
    losses: number;
    opponents: Map<string, { played: number; wins: number; losses: number }>;
  };

  const acc = new Map<string, Acc>();

  const getOrCreate = (lo: string, hi: string): Acc => {
    const k = `${lo}:${hi}`;
    if (!acc.has(k)) {
      acc.set(k, { lo, hi, wins: 0, losses: 0, opponents: new Map() });
    }
    return acc.get(k)!;
  };

  for (const m of matches) {
    const a1 = m.team_a_player_1_id;
    const a2 = m.team_a_player_2_id;
    const b1 = m.team_b_player_1_id;
    const b2 = m.team_b_player_2_id;

    const aLo = a1 < a2 ? a1 : a2;
    const aHi = a1 < a2 ? a2 : a1;
    const bLo = b1 < b2 ? b1 : b2;
    const bHi = b1 < b2 ? b2 : b1;

    const teamA = getOrCreate(aLo, aHi);
    const teamB = getOrCreate(bLo, bHi);
    const kA = `${aLo}:${aHi}`;
    const kB = `${bLo}:${bHi}`;

    const aWon = m.winning_team === "A";
    if (aWon) { teamA.wins++; teamB.losses++; } else { teamB.wins++; teamA.losses++; }

    const aVsB = teamA.opponents.get(kB) ?? { played: 0, wins: 0, losses: 0 };
    teamA.opponents.set(kB, { played: aVsB.played + 1, wins: aVsB.wins + (aWon ? 1 : 0), losses: aVsB.losses + (aWon ? 0 : 1) });

    const bVsA = teamB.opponents.get(kA) ?? { played: 0, wins: 0, losses: 0 };
    teamB.opponents.set(kA, { played: bVsA.played + 1, wins: bVsA.wins + (aWon ? 0 : 1), losses: bVsA.losses + (aWon ? 1 : 0) });
  }

  return Array.from(acc.entries())
    .map(([key, data]) => {
      const p1 = playerMap.get(data.lo);
      const p2 = playerMap.get(data.hi);
      const total = data.wins + data.losses;
      const rivals = [...data.opponents.entries()]
        .sort((a, b) => b[1].played - a[1].played)
        .slice(0, 3)
        .map(([k, r]) => ({ key: k, matchesPlayed: r.played, wins: r.wins, losses: r.losses }));

      return {
        key,
        player_id_lo: data.lo,
        player_id_hi: data.hi,
        matchesPlayed: total,
        wins: data.wins,
        losses: data.losses,
        winRate: total > 0 ? data.wins / total : 0,
        combinedElo: (p1?.current_elo ?? 0) + (p2?.current_elo ?? 0),
        nameRow: nameMap.get(key) ?? null,
        rivals,
      };
    })
    .sort((a, b) => b.combinedElo - a.combinedElo);
}

export function teamColor(team: TeamStats): string {
  if (team.nameRow?.color) return team.nameRow.color;
  let hash = 0;
  for (let i = 0; i < team.key.length; i++) {
    hash = (hash * 31 + team.key.charCodeAt(i)) & 0xffff;
  }
  // Convert HSL to hex so it's always a valid hex string for <input type="color">
  const h = hash % 360;
  const s = 0.7;
  const l = 0.52;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function getTeamDisplayName(
  team: TeamStats,
  players: Player[],
): string {
  if (team.nameRow?.name) return team.nameRow.name;
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const p1 = playerMap.get(team.player_id_lo);
  const p2 = playerMap.get(team.player_id_hi);
  return `${p1?.name ?? "?"} & ${p2?.name ?? "?"}`;
}
