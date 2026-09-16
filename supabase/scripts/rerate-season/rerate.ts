/**
 * Re-rate the active season from its recorded results.
 *
 * Season 4 was rated with the sum-of-residuals series model until 2026-09, when
 * rating moved to the series margin (see supabase/functions/_shared/elo.ts).
 * Nothing recomputes history on its own, so this replays every match of the
 * season in order under the current model and rewrites what the old one wrote:
 * elo_history, player_season_stats.current_season_elo and players.current_elo.
 *
 *   # 1. snapshot the season (read-only)
 *   supabase db query --linked -o json -f supabase/scripts/rerate-season/export.sql > season.json
 *   # 2. dry run: report only
 *   deno run --allow-read supabase/scripts/rerate-season/rerate.ts season.json
 *   # 3. write the transaction, review it, apply it
 *   deno run --allow-read --allow-write supabase/scripts/rerate-season/rerate.ts season.json --sql rerate.sql
 *   supabase db query --linked -f rerate.sql
 *
 * Two safety nets, both deliberate:
 *
 *   - **The replay has to prove itself first.** The same replay is run with the
 *     old model and compared against what is stored, row for row. If it cannot
 *     reproduce the existing ratings exactly, its reading of the season is wrong
 *     somewhere (ordering, starting ratings, a deleted match that left later rows
 *     chained to a result that no longer exists) and the SQL is not written
 *     unless --allow-drift is passed.
 *   - **The SQL refuses to run on a season that has moved.** Every old value it
 *     read is embedded and checked inside the transaction, so a match recorded
 *     between the snapshot and the apply - or applying the same file twice -
 *     aborts with nothing written.
 *
 * Wins and losses are left alone: both models agree on who won, only by how
 * much. Achievements that read rating history need an Admin → recompute after.
 */
import {
  expectedScores,
  type Pair,
  rateSeries,
  roundPreservingSum,
  type SeriesDeltas,
} from "../../functions/_shared/elo.ts";

const SEASON_START_ELO = 1500;

export type Team = "A" | "B";

export interface SeasonSnapshot {
  season: {
    id: string;
    number: number;
    name: string;
    k_factor: number;
    partner_weight: number;
  };
  players: { id: string; name: string; current_elo: number }[];
  seasonStats: {
    player_id: string;
    elo_at_start: number;
    current_season_elo: number;
    wins: number;
    losses: number;
  }[];
  matches: {
    id: string;
    created_at: string;
    team_a: [string, string];
    team_b: [string, string];
    team_a_games: number;
    team_b_games: number;
    winning_team: Team;
  }[];
  history: {
    id: string;
    player_id: string;
    match_id: string | null;
    created_at: string;
    elo_before: number;
    elo_after: number;
    elo_change: number;
    won: boolean | null;
    penalty_type: string | null;
  }[];
}

export type Rater = (
  teamA: Pair,
  teamB: Pair,
  teamAGames: number,
  teamBGames: number,
  kFactor: number,
  partnerWeight: number,
) => SeriesDeltas;

/**
 * The model the league ran on between 2026-08 and 2026-09: every game's
 * residual, summed. Kept here only so the replay can show it reproduces the
 * stored ratings before being trusted to replace them.
 */
export const rateSeriesSumOfResiduals: Rater = (
  teamA,
  teamB,
  teamAGames,
  teamBGames,
  kFactor,
  partnerWeight,
) => {
  const e = expectedScores(teamA, teamB, partnerWeight);
  const games = teamAGames + teamBGames;
  const [a1, a2, b1, b2] = roundPreservingSum([
    kFactor * (teamAGames - games * e.a1),
    kFactor * (teamAGames - games * e.a2),
    kFactor * (teamBGames - games * e.b1),
    kFactor * (teamBGames - games * e.b2),
  ]);
  return { a1, a2, b1, b2 };
};

export interface RowValues {
  elo_before: number;
  elo_after: number;
  elo_change: number;
}

export interface Replay {
  /** New values per elo_history id. */
  rows: Map<string, RowValues>;
  /** Deltas per match id, in lineup order: a1, a2, b1, b2. */
  matchDeltas: Map<string, number[]>;
  /** Final season rating per player with a season row. */
  seasonElo: Map<string, number>;
  /** Final all-time rating per player with a season row. */
  allTimeElo: Map<string, number>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const lineupOf = (m: SeasonSnapshot["matches"][number]) => [
  ...m.team_a,
  ...m.team_b,
];

/** Throws unless the snapshot is something the replay can rebuild faithfully. */
export function validate(snapshot: SeasonSnapshot): void {
  const { season, matches, history, seasonStats, players } = snapshot;
  if (!season) throw new Error("No active season in the snapshot");

  const ints = [
    season.k_factor,
    ...history.flatMap((h) => [
      h.elo_before,
      h.elo_after,
      h.elo_change,
    ]),
    ...seasonStats.flatMap((s) => [s.elo_at_start, s.current_season_elo]),
    ...players.map((p) => p.current_elo),
  ];
  if (!ints.every(Number.isInteger)) {
    throw new Error("Non-integer rating in the snapshot");
  }

  const ids = [
    season.id,
    ...matches.flatMap((m) => [m.id, ...lineupOf(m)]),
    ...history.map((h) => h.id),
    ...seasonStats.map((s) => s.player_id),
  ];
  const badId = ids.find((id) => !UUID.test(id));
  if (badId !== undefined) throw new Error(`Not a UUID: ${badId}`);

  // Inactivity penalties are a percentage of the rating at the time, so they
  // would have to be re-applied mid-replay. None have ever run in a season this
  // was needed for, so rather than guess at it, refuse.
  const penalties = history.filter((h) =>
    h.penalty_type !== null || h.match_id === null
  );
  if (penalties.length > 0) {
    throw new Error(
      `Season has ${penalties.length} penalty row(s); replaying penalties is not supported`,
    );
  }

  const withSeasonRow = new Set(seasonStats.map((s) => s.player_id));
  const nameOf = new Map(players.map((p) => [p.id, p.name]));
  const missing = [...new Set(matches.flatMap(lineupOf))].filter((p) =>
    !withSeasonRow.has(p)
  );
  if (missing.length > 0) {
    throw new Error(
      `No season row for ${
        missing.map((p) => nameOf.get(p) ?? p).join(", ")
      } - ` +
        "apply 20260916_season_stats_for_new_players.sql first",
    );
  }

  const matchById = new Map(matches.map((m) => [m.id, m]));
  const seen = new Set<string>();
  for (const h of history) {
    const m = matchById.get(h.match_id!);
    if (!m) {
      throw new Error(
        `History row ${h.id} points at a match outside the season`,
      );
    }
    const slot = lineupOf(m).indexOf(h.player_id);
    if (slot === -1) {
      throw new Error(
        `History row ${h.id} is for a player not in match ${m.id}`,
      );
    }
    const key = `${m.id}:${h.player_id}`;
    if (seen.has(key)) throw new Error(`Duplicate history row for ${key}`);
    seen.add(key);
    const won = (slot < 2) === (m.winning_team === "A");
    if (h.won !== null && h.won !== won) {
      throw new Error(
        `History row ${h.id} disagrees with match ${m.id} on who won`,
      );
    }
  }

  for (const m of matches) {
    if (new Set(lineupOf(m)).size !== 4) {
      throw new Error(`Match ${m.id} repeats a player`);
    }
    if ((m.team_a_games > m.team_b_games) !== (m.winning_team === "A")) {
      throw new Error(`Match ${m.id}: winning_team disagrees with the tally`);
    }
  }
  if (seen.size !== matches.length * 4) {
    throw new Error(
      `Expected ${
        matches.length * 4
      } history rows for ${matches.length} matches, found ${seen.size}`,
    );
  }
}

/**
 * Replay the season from a clean start under `rate`. Every player begins at the
 * season's 1500 and at their recorded `elo_at_start`, exactly as
 * end_season_and_start_new left them, and each match is rated on the season
 * ratings the replay has reached by then - which is what calculate-elo reads
 * from player_season_stats at the time.
 */
export function replay(snapshot: SeasonSnapshot, rate: Rater): Replay {
  const { season } = snapshot;
  const seasonElo = new Map(
    snapshot.seasonStats.map((s) => [s.player_id, SEASON_START_ELO]),
  );
  const allTimeElo = new Map(
    snapshot.seasonStats.map((s) => [s.player_id, s.elo_at_start]),
  );
  const rowId = new Map(
    snapshot.history.map((h) => [`${h.match_id}:${h.player_id}`, h.id]),
  );
  const rows = new Map<string, RowValues>();
  const matchDeltas = new Map<string, number[]>();

  for (const m of snapshot.matches) {
    const lineup = lineupOf(m);
    const [a1, a2, b1, b2] = lineup.map((p) => seasonElo.get(p)!);
    const d = rate(
      [a1, a2],
      [b1, b2],
      m.team_a_games,
      m.team_b_games,
      season.k_factor,
      Number(season.partner_weight),
    );
    const deltas = [d.a1, d.a2, d.b1, d.b2];
    lineup.forEach((player, i) => {
      const before = allTimeElo.get(player)!;
      rows.set(rowId.get(`${m.id}:${player}`)!, {
        elo_before: before,
        elo_after: before + deltas[i],
        elo_change: deltas[i],
      });
      allTimeElo.set(player, before + deltas[i]);
      seasonElo.set(player, seasonElo.get(player)! + deltas[i]);
    });
    matchDeltas.set(m.id, deltas);
  }

  return { rows, matchDeltas, seasonElo, allTimeElo };
}

export interface Drift {
  rows: { id: string; stored: RowValues; replayed: RowValues }[];
  seasonElo: { player_id: string; stored: number; replayed: number }[];
  allTimeElo: { player_id: string; stored: number; replayed: number }[];
}

/** Where a replay disagrees with the database. Empty everywhere means it reproduces it exactly. */
export function driftFromStored(
  snapshot: SeasonSnapshot,
  replayed: Replay,
): Drift {
  const rows = snapshot.history.flatMap((h) => {
    const r = replayed.rows.get(h.id)!;
    const same = r.elo_before === h.elo_before && r.elo_after === h.elo_after &&
      r.elo_change === h.elo_change;
    return same ? [] : [{ id: h.id, stored: h, replayed: r }];
  });
  const seasonElo = snapshot.seasonStats
    .filter((s) => replayed.seasonElo.get(s.player_id) !== s.current_season_elo)
    .map((s) => ({
      player_id: s.player_id,
      stored: s.current_season_elo,
      replayed: replayed.seasonElo.get(s.player_id)!,
    }));
  const played = new Set(snapshot.history.map((h) => h.player_id));
  const allTimeElo = snapshot.players
    .filter((p) =>
      played.has(p.id) && replayed.allTimeElo.get(p.id) !== p.current_elo
    )
    .map((p) => ({
      player_id: p.id,
      stored: p.current_elo,
      replayed: replayed.allTimeElo.get(p.id)!,
    }));
  return { rows, seasonElo, allTimeElo };
}

export const hasDrift = (d: Drift) =>
  d.rows.length + d.seasonElo.length + d.allTimeElo.length > 0;

export interface PlayerUpdate {
  player_id: string;
  old_season_elo: number;
  new_season_elo: number;
  old_elo: number;
  new_elo: number;
}

/**
 * The per-player writes. The all-time rating moves by exactly as much as the
 * season rating does, rather than being set to the replay's all-time figure, so
 * the season can only ever change what the season itself contributed.
 */
export function playerUpdates(
  snapshot: SeasonSnapshot,
  next: Replay,
): PlayerUpdate[] {
  const currentElo = new Map(
    snapshot.players.map((p) => [p.id, p.current_elo]),
  );
  return snapshot.seasonStats.map((s) => {
    const newSeason = next.seasonElo.get(s.player_id)!;
    const oldElo = currentElo.get(s.player_id)!;
    return {
      player_id: s.player_id,
      old_season_elo: s.current_season_elo,
      new_season_elo: newSeason,
      old_elo: oldElo,
      new_elo: oldElo + (newSeason - s.current_season_elo),
    };
  });
}

/** One transaction: embed the old values, abort if any has moved, then write. */
export function toSql(
  snapshot: SeasonSnapshot,
  next: Replay,
  generatedAt: Date,
): string {
  const { season } = snapshot;
  const history = snapshot.history.map((h) => {
    const n = next.rows.get(h.id)!;
    return `  ('${h.id}', ${h.elo_before}, ${h.elo_after}, ${h.elo_change}, ${n.elo_before}, ${n.elo_after}, ${n.elo_change})`;
  });
  const players = playerUpdates(snapshot, next).map((p) =>
    `  ('${p.player_id}', ${p.old_season_elo}, ${p.new_season_elo}, ${p.old_elo}, ${p.new_elo})`
  );
  const weight = Number(season.partner_weight);

  return `-- Re-rate season ${season.number} under the series-margin model.
-- Generated by supabase/scripts/rerate-season/rerate.ts at ${generatedAt.toISOString()}.
-- ${snapshot.matches.length} matches, ${snapshot.history.length} elo_history rows, ${players.length} players.
--
-- Aborts with nothing written if the season has changed since the snapshot,
-- including if this file has already been applied.

BEGIN;

CREATE TEMP TABLE rerate_history (
  id uuid PRIMARY KEY,
  old_before int NOT NULL, old_after int NOT NULL, old_change int NOT NULL,
  new_before int NOT NULL, new_after int NOT NULL, new_change int NOT NULL
) ON COMMIT DROP;
INSERT INTO rerate_history VALUES
${history.join(",\n")};

CREATE TEMP TABLE rerate_player (
  player_id uuid PRIMARY KEY,
  old_season_elo int NOT NULL, new_season_elo int NOT NULL,
  old_elo int NOT NULL, new_elo int NOT NULL
) ON COMMIT DROP;
INSERT INTO rerate_player VALUES
${players.join(",\n")};

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM seasons
     WHERE id = '${season.id}' AND is_active
       AND k_factor = ${season.k_factor} AND partner_weight = ${weight}
  ) THEN
    RAISE EXCEPTION 'Season ${season.number} is no longer active on K=${season.k_factor}, w=${weight}';
  END IF;

  IF (SELECT count(*) FROM elo_history WHERE season_id = '${season.id}') <> ${snapshot.history.length}
     OR EXISTS (
       SELECT 1 FROM rerate_history r
         LEFT JOIN elo_history eh ON eh.id = r.id AND eh.season_id = '${season.id}'
        WHERE eh.id IS NULL
           OR (eh.elo_before, eh.elo_after, eh.elo_change)
              IS DISTINCT FROM (r.old_before, r.old_after, r.old_change))
     OR EXISTS (
       SELECT 1 FROM rerate_player r
         LEFT JOIN player_season_stats pss
           ON pss.player_id = r.player_id AND pss.season_id = '${season.id}'
         LEFT JOIN players p ON p.id = r.player_id
        WHERE pss.id IS NULL OR p.id IS NULL
           OR pss.current_season_elo <> r.old_season_elo
           OR p.current_elo <> r.old_elo)
  THEN
    RAISE EXCEPTION 'Season ${season.number} has changed since the snapshot (a match recorded or deleted, or this file already applied). Re-export and re-run.';
  END IF;
END $$;

UPDATE elo_history eh
   SET elo_before = r.new_before, elo_after = r.new_after, elo_change = r.new_change
  FROM rerate_history r
 WHERE eh.id = r.id;

UPDATE player_season_stats pss
   SET current_season_elo = r.new_season_elo
  FROM rerate_player r
 WHERE pss.player_id = r.player_id AND pss.season_id = '${season.id}';

UPDATE players p
   SET current_elo = r.new_elo
  FROM rerate_player r
 WHERE p.id = r.player_id;

COMMIT;
`;
}

// ---------------------------------------------------------------------------
// Report

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0");
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padStart = (s: string | number, n: number) => String(s).padStart(n);

export function report(
  snapshot: SeasonSnapshot,
  reproduction: Drift,
  previous: Replay,
  next: Replay,
): string {
  const { season, matches, players, seasonStats } = snapshot;
  const nameOf = new Map(players.map((p) => [p.id, p.name]));
  const out: string[] = [];

  out.push(
    `Season ${season.number} "${season.name}" - K=${season.k_factor}, partner weight ${
      Number(season.partner_weight)
    }`,
    `${matches.length} matches, ${snapshot.history.length} elo_history rows`,
    "",
  );

  out.push("Old model reproduces the stored ratings:");
  out.push(
    `  elo_history rows   ${
      snapshot.history.length - reproduction.rows.length
    }/${snapshot.history.length} exact`,
  );
  out.push(
    `  season ratings     ${
      seasonStats.length - reproduction.seasonElo.length
    }/${seasonStats.length} exact`,
  );
  out.push(
    `  all-time ratings   ${
      reproduction.allTimeElo.length === 0
        ? "all exact"
        : `${reproduction.allTimeElo.length} differ`
    }`,
  );
  for (const d of reproduction.seasonElo) {
    out.push(
      `    ! ${
        nameOf.get(d.player_id)
      }: stored ${d.stored}, replayed ${d.replayed}`,
    );
  }
  for (const d of reproduction.allTimeElo) {
    out.push(
      `    ! ${
        nameOf.get(d.player_id)
      } all-time: stored ${d.stored}, replayed ${d.replayed}`,
    );
  }
  out.push("");

  const changed = matches.filter((m) =>
    previous.matchDeltas.get(m.id)!.some((d, i) =>
      d !== next.matchDeltas.get(m.id)![i]
    )
  );
  out.push(
    `Matches whose deltas change: ${changed.length} of ${matches.length}`,
  );
  const team = (ids: string[]) => ids.map((id) => nameOf.get(id)).join(" + ");
  const deltas = (d: number[]) =>
    `${d.slice(0, 2).map(signed).join(" ")} | ${
      d.slice(2).map(signed).join(" ")
    }`;
  for (const m of changed) {
    const date = new Date(m.created_at).toLocaleDateString("de-CH");
    out.push(
      `  ${pad(date, 11)} ${
        team(m.team_a)
      } ${m.team_a_games}:${m.team_b_games} ${team(m.team_b)}`,
      `  ${pad("", 11)} old ${
        deltas(previous.matchDeltas.get(m.id)!)
      }   →   new ${deltas(next.matchDeltas.get(m.id)!)}`,
    );
  }
  out.push("");

  const played = seasonStats.filter((s) => s.wins + s.losses > 0);
  const ranked = (elo: (id: string) => number) =>
    [...played].sort((x, y) =>
      elo(y.player_id) - elo(x.player_id) ||
      nameOf.get(x.player_id)!.localeCompare(nameOf.get(y.player_id)!)
    ).map((s) => s.player_id);
  const oldOrder = ranked((id) =>
    seasonStats.find((s) => s.player_id === id)!.current_season_elo
  );
  const newOrder = ranked((id) => next.seasonElo.get(id)!);

  out.push("Standings (players with a game this season):");
  out.push(
    `  ${pad("#", 4)}${pad("player", 14)}${pad("W-L", 7)}${
      padStart("stored", 7)
    }${padStart("new", 7)}${padStart("Δ", 6)}   rank`,
  );
  newOrder.forEach((id, i) => {
    const s = seasonStats.find((x) => x.player_id === id)!;
    const newElo = next.seasonElo.get(id)!;
    const oldRank = oldOrder.indexOf(id) + 1;
    const move = oldRank === i + 1
      ? ""
      : oldRank > i + 1
      ? `↑ from ${oldRank}`
      : `↓ from ${oldRank}`;
    out.push(
      `  ${pad(i + 1, 4)}${pad(nameOf.get(id)!, 14)}${
        pad(`${s.wins}-${s.losses}`, 7)
      }` +
        `${padStart(s.current_season_elo, 7)}${padStart(newElo, 7)}${
          padStart(signed(newElo - s.current_season_elo), 6)
        }   ${move}`,
    );
  });

  return out.join("\n");
}

// ---------------------------------------------------------------------------

if (import.meta.main) {
  const [input, ...flags] = Deno.args;
  const sqlIndex = flags.indexOf("--sql");
  const sqlPath = sqlIndex === -1 ? null : flags[sqlIndex + 1];
  const allowDrift = flags.includes("--allow-drift");
  if (!input || (sqlIndex !== -1 && !sqlPath)) {
    console.error(
      "usage: rerate.ts <season.json> [--sql <out.sql>] [--allow-drift]",
    );
    Deno.exit(2);
  }

  // Accepts the raw `supabase db query -o json` envelope as well as the bare object.
  const raw = JSON.parse(await Deno.readTextFile(input));
  const snapshot: SeasonSnapshot = raw.rows?.[0]?.data ?? raw;
  for (const key of ["seasonStats", "matches", "history"] as const) {
    snapshot[key] ??= [];
  }

  validate(snapshot);
  const previous = replay(snapshot, rateSeriesSumOfResiduals);
  const reproduction = driftFromStored(snapshot, previous);
  const next = replay(snapshot, rateSeries);

  console.log(report(snapshot, reproduction, previous, next));

  if (sqlPath) {
    if (hasDrift(reproduction) && !allowDrift) {
      console.error(
        "\nNot writing SQL: the old model does not reproduce what is stored, so this " +
          "replay's reading of the season can't be trusted. Pass --allow-drift to override.",
      );
      Deno.exit(1);
    }
    await Deno.writeTextFile(sqlPath, toSql(snapshot, next, new Date()));
    console.log(`\nWrote ${sqlPath}`);
  }
}
