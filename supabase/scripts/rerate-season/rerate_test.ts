import { assert, assertEquals, assertThrows } from "@std/assert";
import { rateSeries } from "../../functions/_shared/elo.ts";
import {
  driftFromStored,
  hasDrift,
  playerUpdates,
  type Rater,
  rateSeriesSumOfResiduals,
  replay,
  type SeasonSnapshot,
  toSql,
  validate,
} from "./rerate.ts";

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SEASON_ID = uuid(9000);

type Result = {
  a: [number, number];
  b: [number, number];
  score: [number, number];
};

/**
 * Build a season the way calculate-elo would have recorded it under `rater`:
 * rated on season Elo, applied to all-time Elo, four history rows per match.
 */
function recordSeason(
  startElos: number[],
  results: Result[],
  rater: Rater,
): SeasonSnapshot {
  const ids = startElos.map((_, i) => uuid(i + 1));
  const seasonElo = ids.map(() => 1500);
  const allTime = [...startElos];
  const snapshot: SeasonSnapshot = {
    season: {
      id: SEASON_ID,
      number: 4,
      name: "Test",
      k_factor: 48,
      partner_weight: 0.25,
    },
    players: [],
    seasonStats: [],
    matches: [],
    history: [],
  };

  results.forEach((r, i) => {
    const matchId = uuid(100 + i);
    const createdAt = new Date(Date.UTC(2026, 7, 10, 12, i)).toISOString();
    const lineup = [...r.a, ...r.b];
    const d = rater(
      [seasonElo[r.a[0]], seasonElo[r.a[1]]],
      [seasonElo[r.b[0]], seasonElo[r.b[1]]],
      r.score[0],
      r.score[1],
      48,
      0.25,
    );
    const aWon = r.score[0] > r.score[1];
    snapshot.matches.push({
      id: matchId,
      created_at: createdAt,
      team_a: [ids[r.a[0]], ids[r.a[1]]],
      team_b: [ids[r.b[0]], ids[r.b[1]]],
      team_a_games: r.score[0],
      team_b_games: r.score[1],
      winning_team: aWon ? "A" : "B",
    });
    [d.a1, d.a2, d.b1, d.b2].forEach((delta, slot) => {
      const p = lineup[slot];
      snapshot.history.push({
        id: uuid(1000 + i * 4 + slot),
        player_id: ids[p],
        match_id: matchId,
        created_at: createdAt,
        elo_before: allTime[p],
        elo_after: allTime[p] + delta,
        elo_change: delta,
        won: (slot < 2) === aWon,
        penalty_type: null,
      });
      allTime[p] += delta;
      seasonElo[p] += delta;
    });
  });

  snapshot.players = ids.map((id, i) => ({
    id,
    name: `P${i + 1}`,
    current_elo: allTime[i],
  }));
  snapshot.seasonStats = ids.map((id, i) => ({
    player_id: id,
    elo_at_start: startElos[i],
    current_season_elo: seasonElo[i],
    wins: 0,
    losses: 0,
  }));
  return snapshot;
}

const START = [1900, 1400, 1550, 1450, 1600];
// Includes the case the margin model exists for: a favourite taking a 3:2.
const RESULTS: Result[] = [
  { a: [0, 1], b: [2, 3], score: [2, 0] },
  { a: [0, 2], b: [1, 4], score: [3, 2] },
  { a: [3, 4], b: [0, 1], score: [1, 2] },
  { a: [1, 2], b: [3, 0], score: [1, 0] },
  { a: [0, 4], b: [2, 3], score: [2, 1] },
];

Deno.test("replay reproduces a season recorded under the same model", () => {
  const snapshot = recordSeason(START, RESULTS, rateSeriesSumOfResiduals);
  validate(snapshot);
  const drift = driftFromStored(
    snapshot,
    replay(snapshot, rateSeriesSumOfResiduals),
  );
  assert(!hasDrift(drift), JSON.stringify(drift));
});

Deno.test("re-rating under margin equals recording under margin from the start", () => {
  const recordedOld = recordSeason(START, RESULTS, rateSeriesSumOfResiduals);
  const recordedNew = recordSeason(START, RESULTS, rateSeries);
  const next = replay(recordedOld, rateSeries);

  for (const s of recordedNew.seasonStats) {
    assertEquals(next.seasonElo.get(s.player_id), s.current_season_elo);
  }
  const updates = playerUpdates(recordedOld, next);
  for (const p of recordedNew.players) {
    assertEquals(
      updates.find((u) => u.player_id === p.id)!.new_elo,
      p.current_elo,
    );
  }
});

Deno.test("re-rated season: zero-sum per match, and no winner loses rating", () => {
  const snapshot = recordSeason(START, RESULTS, rateSeriesSumOfResiduals);
  const next = replay(snapshot, rateSeries);
  for (const m of snapshot.matches) {
    const d = next.matchDeltas.get(m.id)!;
    assertEquals(d.reduce((x, y) => x + y, 0), 0);
    const winners = m.winning_team === "A" ? d.slice(0, 2) : d.slice(2);
    assert(winners.every((x) => x >= 0), `${m.id}: ${d}`);
  }
  const total = [...next.seasonElo.values()].reduce((x, y) => x + y, 0);
  assertEquals(total, 1500 * START.length);
});

Deno.test("a deleted match leaves drift the replay refuses to paper over", () => {
  const snapshot = recordSeason(START, RESULTS, rateSeriesSumOfResiduals);
  // What deleteMatch does: the rows go, later rows keep their old chain.
  const gone = snapshot.matches.splice(1, 1)[0].id;
  snapshot.history = snapshot.history.filter((h) => h.match_id !== gone);
  validate(snapshot);
  assert(
    hasDrift(
      driftFromStored(snapshot, replay(snapshot, rateSeriesSumOfResiduals)),
    ),
  );
});

Deno.test("validate rejects penalties and players without a season row", () => {
  const withPenalty = recordSeason(START, RESULTS, rateSeriesSumOfResiduals);
  withPenalty.history.push({
    ...withPenalty.history[0],
    id: uuid(5000),
    match_id: null,
    penalty_type: "inactivity",
  });
  assertThrows(() => validate(withPenalty), Error, "penalty");

  const missingRow = recordSeason(START, RESULTS, rateSeriesSumOfResiduals);
  missingRow.seasonStats.pop();
  assertThrows(() => validate(missingRow), Error, "No season row for P5");
});

Deno.test("SQL embeds the old values it guards on and one transaction", () => {
  const snapshot = recordSeason(START, RESULTS, rateSeriesSumOfResiduals);
  const sql = toSql(snapshot, replay(snapshot, rateSeries), new Date(0));
  assertEquals(sql.match(/^BEGIN;$/gm)?.length, 1);
  assertEquals(sql.match(/^COMMIT;$/gm)?.length, 1);
  assert(
    sql.includes(
      `WHERE season_id = '${SEASON_ID}') <> ${snapshot.history.length}`,
    ),
  );
  const h = snapshot.history[5];
  assert(
    sql.includes(
      `('${h.id}', ${h.elo_before}, ${h.elo_after}, ${h.elo_change},`,
    ),
  );
});
