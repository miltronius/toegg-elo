import { describe, it, expect } from "vitest";
import {
  teamKey,
  teamKeyParts,
  computeTeamStats,
  teamColor,
  getTeamDisplayName,
} from "./teamUtils";
import type { Match, Player } from "./supabase";
import type { TeamNameRow } from "./supabase";

// ── helpers ───────────────────────────────────────────────────────────────────

const p = (id: string, name: string, elo = 1500): Player => ({
  id,
  name,
  current_elo: elo,
  matches_played: 0,
  wins: 0,
  losses: 0,
  created_at: "2024-01-01T00:00:00Z",
});

const match = (
  a1: string,
  a2: string,
  b1: string,
  b2: string,
  winner: "A" | "B",
): Match => ({
  id: `${a1}-${a2}-${b1}-${b2}-${winner}`,
  team_a_player_1_id: a1,
  team_a_player_2_id: a2,
  team_b_player_1_id: b1,
  team_b_player_2_id: b2,
  winning_team: winner,
  created_at: "2024-01-01T00:00:00Z",
});

// ── teamKey ───────────────────────────────────────────────────────────────────

describe("teamKey", () => {
  it("returns lo:hi canonical order for any input order", () => {
    expect(teamKey("aaa", "bbb")).toBe("aaa:bbb");
    expect(teamKey("bbb", "aaa")).toBe("aaa:bbb");
  });

  it("is idempotent for the same pair", () => {
    const k1 = teamKey("x", "y");
    const k2 = teamKey("y", "x");
    expect(k1).toBe(k2);
  });
});

// ── teamKeyParts ──────────────────────────────────────────────────────────────

describe("teamKeyParts", () => {
  it("splits a key back into [lo, hi]", () => {
    const [lo, hi] = teamKeyParts("aaa:bbb");
    expect(lo).toBe("aaa");
    expect(hi).toBe("bbb");
  });
});

// ── computeTeamStats ──────────────────────────────────────────────────────────

describe("computeTeamStats", () => {
  const alice = p("aaa", "Alice", 1600);
  const bob = p("bbb", "Bob", 1500);
  const carl = p("ccc", "Carl", 1400);
  const dave = p("ddd", "Dave", 1300);
  const players = [alice, bob, carl, dave];

  it("returns empty array for no matches", () => {
    expect(computeTeamStats([], players, [])).toHaveLength(0);
  });

  it("canonicalises (A,B) and (B,A) as the same team", () => {
    const matches: Match[] = [
      match("aaa", "bbb", "ccc", "ddd", "A"),
      match("bbb", "aaa", "ccc", "ddd", "B"), // same team pair, reversed
    ];
    const teams = computeTeamStats(matches, players, []);
    const ab = teams.find(
      (t) => t.player_id_lo === "aaa" && t.player_id_hi === "bbb",
    );
    expect(ab).toBeDefined();
    expect(ab!.matchesPlayed).toBe(2);
    expect(ab!.wins).toBe(1);
    expect(ab!.losses).toBe(1);
  });

  it("computes winRate correctly", () => {
    const matches: Match[] = [
      match("aaa", "bbb", "ccc", "ddd", "A"),
      match("aaa", "bbb", "ccc", "ddd", "A"),
      match("aaa", "bbb", "ccc", "ddd", "B"),
    ];
    const teams = computeTeamStats(matches, players, []);
    const ab = teams.find((t) => t.player_id_lo === "aaa");
    expect(ab!.wins).toBe(2);
    expect(ab!.losses).toBe(1);
    expect(ab!.winRate).toBeCloseTo(2 / 3);
  });

  it("computes combinedElo from player current_elo", () => {
    const matches: Match[] = [match("aaa", "bbb", "ccc", "ddd", "A")];
    const teams = computeTeamStats(matches, players, []);
    const ab = teams.find((t) => t.player_id_lo === "aaa");
    expect(ab!.combinedElo).toBe(alice.current_elo + bob.current_elo);
  });

  it("attaches nameRow when one exists", () => {
    const nameRow: TeamNameRow = {
      player_id_lo: "aaa",
      player_id_hi: "bbb",
      name: "Dream Team",
      alias_1: "DT",
      alias_2: null,
      color: null,
      updated_at: "2024-01-01T00:00:00Z",
    };
    const matches: Match[] = [match("aaa", "bbb", "ccc", "ddd", "A")];
    const teams = computeTeamStats(matches, players, [nameRow]);
    const ab = teams.find((t) => t.player_id_lo === "aaa");
    expect(ab!.nameRow?.name).toBe("Dream Team");
  });

  it("tracks rival W/L counts correctly", () => {
    const matches: Match[] = [
      match("aaa", "bbb", "ccc", "ddd", "A"), // AB wins vs CD
      match("aaa", "bbb", "ccc", "ddd", "B"), // AB loses vs CD
      match("aaa", "bbb", "ccc", "ddd", "A"), // AB wins vs CD
    ];
    const teams = computeTeamStats(matches, players, []);
    const ab = teams.find((t) => t.player_id_lo === "aaa")!;
    expect(ab.rivals).toHaveLength(1);
    expect(ab.rivals[0].matchesPlayed).toBe(3);
    expect(ab.rivals[0].wins).toBe(2);
    expect(ab.rivals[0].losses).toBe(1);
  });

  it("returns at most 3 rivals sorted by losses (nemesis) then matches played", () => {
    // AB loses to EF ×2 (fewer games but more losses → should be #1 nemesis)
    // AB beats CD ×3 (more games but 0 losses → ranked lower)
    // AB loses to GH ×1 (1 loss, fewer matches → ranked #2)
    const e = p("eee", "Eve", 1450);
    const f = p("fff", "Frank", 1350);
    const g = p("ggg", "Grace", 1250);
    const h = p("hhh", "Henry", 1150);
    const allPlayers = [alice, bob, carl, dave, e, f, g, h];
    const matches: Match[] = [
      match("aaa", "bbb", "ccc", "ddd", "A"), // AB wins
      match("aaa", "bbb", "ccc", "ddd", "A"), // AB wins
      match("aaa", "bbb", "ccc", "ddd", "A"), // AB wins (3 games, 0 losses vs CD)
      match("aaa", "bbb", "eee", "fff", "B"), // AB loses
      match("aaa", "bbb", "eee", "fff", "B"), // AB loses (2 games, 2 losses vs EF)
      match("aaa", "bbb", "ggg", "hhh", "B"), // AB loses (1 game, 1 loss vs GH)
    ];
    const teams = computeTeamStats(matches, allPlayers, []);
    const ab = teams.find((t) => t.player_id_lo === "aaa")!;
    expect(ab.rivals.length).toBeLessThanOrEqual(3);
    // EF is the nemesis (2 losses) — must be first
    const efKey = teamKey("eee", "fff");
    expect(ab.rivals[0].key).toBe(efKey);
    expect(ab.rivals[0].losses).toBe(2);
    // CD has 0 losses — should be last despite most matches
    const cdKey = teamKey("ccc", "ddd");
    expect(ab.rivals[ab.rivals.length - 1].key).toBe(cdKey);
  });
});

// ── teamColor ─────────────────────────────────────────────────────────────────

describe("teamColor", () => {
  const baseTeam = {
    key: "aaa:bbb",
    player_id_lo: "aaa",
    player_id_hi: "bbb",
    matchesPlayed: 1,
    wins: 1,
    losses: 0,
    winRate: 1,
    combinedElo: 3000,
    rivals: [],
  };

  it("returns nameRow.color when set", () => {
    const team = { ...baseTeam, nameRow: { color: "#ff0000" } as TeamNameRow };
    expect(teamColor(team)).toBe("#ff0000");
  });

  it("returns a valid hex color when nameRow has no color", () => {
    const team = { ...baseTeam, nameRow: null };
    const color = teamColor(team);
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("is deterministic for the same key", () => {
    const team = { ...baseTeam, nameRow: null };
    expect(teamColor(team)).toBe(teamColor(team));
  });

  it("produces different colors for different keys", () => {
    const t1 = { ...baseTeam, key: "aaa:bbb", nameRow: null };
    const t2 = { ...baseTeam, key: "ccc:ddd", nameRow: null };
    expect(teamColor(t1)).not.toBe(teamColor(t2));
  });
});

// ── getTeamDisplayName ────────────────────────────────────────────────────────

describe("getTeamDisplayName", () => {
  const alice = p("aaa", "Alice");
  const bob = p("bbb", "Bob");
  const baseTeam = {
    key: "aaa:bbb",
    player_id_lo: "aaa",
    player_id_hi: "bbb",
    matchesPlayed: 1,
    wins: 1,
    losses: 0,
    winRate: 1,
    combinedElo: 3000,
    rivals: [],
    nameRow: null,
  };

  it("returns nameRow.name when set", () => {
    const team = {
      ...baseTeam,
      nameRow: { name: "Dream Team" } as TeamNameRow,
    };
    expect(getTeamDisplayName(team, [alice, bob])).toBe("Dream Team");
  });

  it("falls back to 'P1 & P2' format", () => {
    expect(getTeamDisplayName(baseTeam, [alice, bob])).toBe("Alice & Bob");
  });

  it("uses ? for unknown player ids", () => {
    expect(getTeamDisplayName(baseTeam, [])).toBe("? & ?");
  });
});
