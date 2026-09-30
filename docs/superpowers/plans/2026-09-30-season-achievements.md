# Season Achievements (#120) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Achievements that can be earned once per season (On the Board, Season Champion … Top Ten, In the Green), on a schema that lets one achievement id be held several times, which the Season Awards (#121, #122) reuse.

**Architecture:** `player_achievements` gains a nullable `season_id`; the unique key becomes `(player_id, achievement_id, season_id)` with `NULLS NOT DISTINCT`, so one-time achievements (NULL) still dedupe. Placements are derived purely from stored `player_season_stats` of ended seasons (`computeSeasonPlacements`), participation from the season's matches; both feed `computeAchievementsForPlayer`, whose meta-achievements now count distinct ids. Display groups rows by id (×N, seasons in the tooltip) and rarity counts players, not rows.

**Tech Stack:** Supabase Postgres (PG 17.6 on staging), React 19 + TS, react-i18next, Vitest + RTL, Deno test.

**Spec:** `docs/superpowers/specs/2026-09-24-player-linking-and-season-awards-design.md` (on branch `docs/season-awards-spec`), section 3 and "Cross-cutting rules". Issue: miltronius/toegg-elo#120.

## Global Constraints

- `player_achievements.season_id UUID NULL REFERENCES seasons ON DELETE CASCADE`. NULL = one-time achievement.
- Unique key `UNIQUE NULLS NOT DISTINCT (player_id, achievement_id, season_id)`; every upsert uses `onConflict: "player_id,achievement_id,season_id"`. Needs Postgres 15+: staging is 17.6; **prod must be checked by the user** (prod reads are not allowed from this session).
- Ids / icons / names (en · de) / descriptions, verbatim:
  - `season_participated` 📋 On the Board · Mit von der Partie - "Play 3 games in a season" · "Spiele 3 Partien in einer Saison"
  - `season_top_1` 🏆 Season Champion · Saisonsieger - "Finish a season in 1st place" · "Beende eine Saison auf Platz 1"
  - `season_top_2` 🥈 Runner-Up · Vizemeister - "Finish a season in 2nd place" · "Beende eine Saison auf Platz 2"
  - `season_top_3` 🥉 Podium · Podest - "Finish a season in 3rd place" · "Beende eine Saison auf Platz 3"
  - `season_top_5` 🖐️ High Five · High Five - "Finish a season in the top 5" · "Beende eine Saison unter den Top 5"
  - `season_top_10` 🔟 Top Ten · Top Ten - "Finish a season in the top 10" · "Beende eine Saison unter den Top 10"
  - `season_net_positive` 💹 In the Green · Im grünen Bereich - "Finish a season ranked, above 1500" · "Beende eine Saison gewertet und über 1500"
- Ranked = ≥ 3 games (series) in the season, `RANKED_MIN_GAMES = 3` (mirrors `frontend/src/lib/rosterFilter.ts`).
- Placements: ended seasons only (`ended_at` set), from stored `player_season_stats` (`current_season_elo`, `wins + losses`). Rank among ranked players by `current_season_elo` desc, ties share a rank (1, 2, 2, 4). Awarded only if the season has **≥ 5 ranked players**; Top N also needs **more than N** ranked players. Only the **best** tier. `unlocked_at = seasons.ended_at`.
- Net positive: ranked and final `current_season_elo >= 1501`; not subject to the ≥ 5 floor. `unlocked_at = ended_at`.
- Participated: 3rd match of the player in that `season_id` (active seasons included), `unlocked_at` = that match's `created_at`. Not subject to the floor.
- Meta-achievements (`achievement_hunter` 10, `completionist` 20, `completionist_30` 30) count **distinct ids**; unlock date = when the Nth distinct id was first earned.
- Rarity = % of players holding the id at least once.
- Both achievement files (`frontend/src/lib/achievements.ts`, `supabase/functions/_shared/achievements.ts`) get identical new code. TS strings use `"`. German uses Swiss spelling (`ss`).
- Commits: **no `Co-Authored-By` trailer** (user preference, overrides the harness default).
- Staging (`kitwrozsauxcwcycxibb`) may be migrated and checked freely; **prod needs the user's explicit approval**.
- **Release order:** migration → `calculate-elo` deploy → frontend. Between the migration and the function deploy, the old function's upsert (`onConflict: player_id,achievement_id`) has no matching constraint and fails - non-fatally (the match still records; achievements catch up on the next match). Keep that gap short.

## Decisions made while planning (not in the spec - review these)

1. **`link_player_account` must be replaced in this migration.** It inserts That's Me! with `ON CONFLICT (player_id, achievement_id)`, which stops matching any constraint once the old unique key is dropped - every claim would then fail. The migration re-creates it with the new conflict target.
2. `recomputeAllAchievements`'s optional 4th argument changes from `links` to a pre-read bundle `{ links, seasons, seasonStats }` (the admin recompute must read everything before its delete). #122 adds `awardResults` to the same bundle.
3. Season Stats' "achievements unlocked" counts a seasonal row by its `season_id`, not by date - placements are dated `ended_at`, which equals the next season's `started_at`, so the date window would credit them to the wrong season.
4. The unused `upsertPlayerAchievements` in `supabase.ts` is deleted rather than migrated.
5. `AchievementStatus.unlockedAt` for a repeated achievement is the **latest** unlock (so "by date" sorting surfaces a fresh placement).

## Review Focus

1. **Claiming a player after the migration** → still works and grants That's Me! once. Pinned by re-running `supabase/scripts/player-accounts-checks.sql` on staging (Task 6).
2. **A recompute run twice / by calculate-elo after a season recompute** → no duplicate one-time rows (NULL season must conflict with NULL). Pinned by the staging conflict check (Task 6).
3. **A 5-player season where ranks 4 and 5 tie, or where 2 players tie for 1st** → both tied players get the same tier; nobody gets Top 5 because 5 is not > 5. Deno tests in Task 2.
4. **Admin Recompute while the seasons read fails** → nothing is deleted. Pinned by the pre-read test (Task 3).
5. **A player with the same seasonal achievement in 3 seasons** → shown once with ×3, counted once toward the "players" table and the rarity %, listed once in the overview's achiever bubble. Vitest in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260930_season_achievements.sql` (new) | `season_id`, new unique key, re-created `link_player_account` |
| `supabase/functions/_shared/achievements.ts` | ids, `seasonId` on unlocks, `computeSeasonParticipation`, `computeSeasonPlacements`, distinct-id metas, recompute reads seasons + stats |
| `frontend/src/lib/achievements.ts` | same, plus definitions, grouped statuses, player-based rarity |
| `supabase/functions/calculate-elo/achievements_test.ts` | Deno tests for the derivation |
| `frontend/src/lib/achievements.test.ts` | pre-read bundle, grouping, rarity |
| `frontend/src/lib/supabase.ts` | pre-read in admin recompute, recompute after season end, drop `upsertPlayerAchievements` |
| `frontend/src/components/Achievements.tsx` | ×N + season tooltip, deduped achievers |
| `frontend/src/components/PlayerDetail.tsx` | passes `seasons` into the gallery |
| `frontend/src/lib/seasonStats.ts` (+ test) | season-scoped count by `season_id` |
| `frontend/src/locales/{en,de}.json` | strings |
| `CLAUDE.md`, `.changeset/*.md` | docs, minor changeset |

---

### Task 1: Migration

**Files:**
- Create: `supabase/migrations/20260930_season_achievements.sql`

**Interfaces:**
- Produces: column `player_achievements.season_id`; constraint `player_achievements_player_achievement_season_key UNIQUE NULLS NOT DISTINCT (player_id, achievement_id, season_id)`.

- [ ] **Step 1: Write the migration**

```sql
-- Repeatable per-season achievements (#120). A row with season_id NULL is a
-- one-time achievement (every achievement before this migration); a row with a
-- season is earned again each season. NULLS NOT DISTINCT keeps the one-time
-- rows unique on (player_id, achievement_id) exactly as before. Needs PG 15+.
--
-- Safe to re-run: these are applied by hand in the SQL editor.
--
-- Release order: apply this, then deploy calculate-elo, then the frontend.
-- Until the function is redeployed its upsert names the old conflict target
-- and fails (non-fatally - the match still records).

ALTER TABLE player_achievements
  ADD COLUMN IF NOT EXISTS season_id UUID REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE player_achievements
  DROP CONSTRAINT IF EXISTS player_achievements_player_id_achievement_id_key;
ALTER TABLE player_achievements
  DROP CONSTRAINT IF EXISTS player_achievements_player_achievement_season_key;
ALTER TABLE player_achievements
  ADD CONSTRAINT player_achievements_player_achievement_season_key
  UNIQUE NULLS NOT DISTINCT (player_id, achievement_id, season_id);

CREATE INDEX IF NOT EXISTS idx_player_achievements_season
  ON player_achievements(season_id) WHERE season_id IS NOT NULL;

-- Unchanged from 20260927_player_accounts.sql except the ON CONFLICT target:
-- the old (player_id, achievement_id) key no longer exists, and an ON CONFLICT
-- that names no constraint is an error, so every claim would fail without this.
CREATE OR REPLACE FUNCTION link_player_account(p_user_id UUID, p_player_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_linked_at TIMESTAMPTZ;
  v_constraint TEXT;
BEGIN
  IF COALESCE((SELECT role FROM profiles WHERE id = p_user_id), '')
       NOT IN ('user', 'admin') THEN
    RAISE EXCEPTION 'account_not_eligible';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM players WHERE id = p_player_id) THEN
    RAISE EXCEPTION 'player_not_found';
  END IF;
  IF EXISTS (SELECT 1 FROM player_accounts WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'account_already_linked';
  END IF;
  IF EXISTS (SELECT 1 FROM player_accounts WHERE player_id = p_player_id) THEN
    RAISE EXCEPTION 'player_already_linked';
  END IF;

  BEGIN
    INSERT INTO player_accounts (player_id, user_id)
    VALUES (p_player_id, p_user_id)
    RETURNING linked_at INTO v_linked_at;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent claim got there between the checks and the insert.
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'player_accounts_pkey' THEN
      RAISE EXCEPTION 'player_already_linked';
    END IF;
    RAISE EXCEPTION 'account_already_linked';
  END;

  -- Same row recomputeAllAchievements derives (unlocked_at = linked_at), so a
  -- later recompute neither duplicates nor moves it.
  INSERT INTO player_achievements (player_id, achievement_id, unlocked_at, meta, season_id)
  VALUES (p_player_id, 'linked_account', v_linked_at, NULL, NULL)
  ON CONFLICT (player_id, achievement_id, season_id)
  DO UPDATE SET unlocked_at = EXCLUDED.unlocked_at, meta = NULL;
END;
$$;

REVOKE ALL ON FUNCTION link_player_account(UUID, UUID) FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260930_season_achievements.sql
git commit -m "ELO-120: Per-season achievement rows"
```

(Applied and checked on staging in Task 6, once the code that writes the new key exists.)

---

### Task 2: Shared derivation (edge function copy) + Deno tests

**Files:**
- Modify: `supabase/functions/_shared/achievements.ts`
- Test: `supabase/functions/calculate-elo/achievements_test.ts`

**Interfaces:**
- Produces (exported from `_shared/achievements.ts`, mirrored verbatim into the frontend in Task 3):
  - `AchievementId` += `"season_participated" | "season_top_1" | "season_top_2" | "season_top_3" | "season_top_5" | "season_top_10" | "season_net_positive"`
  - `interface UnlockedAchievement { achievementId; unlockedAt: Date; meta?; seasonId?: string }` (now exported)
  - `Match` += `season_id: string | null`
  - `interface SeasonRow { id: string; number: number; started_at: string; ended_at: string | null }`
  - `interface SeasonStatRow { player_id: string; season_id: string; current_season_elo: number; wins: number; losses: number }`
  - `const RANKED_MIN_GAMES = 3`
  - `computeSeasonParticipation(playerId: string, sorted: Match[]): UnlockedAchievement[]`
  - `computeSeasonPlacements(seasons: SeasonRow[], stats: SeasonStatRow[]): Map<string, UnlockedAchievement[]>` (key = player id)
  - `computeAchievementsForPlayer(playerId, _player, matches, allPlayers = [], eloHistory = [], linkedAt = null, extra: UnlockedAchievement[] = [])`
  - `interface AchievementPreRead { links: PlayerAccountLink[]; seasons: SeasonRow[]; seasonStats: SeasonStatRow[] }`
  - `recomputeAllAchievements(supabase, players, matches, pre?: AchievementPreRead)`

- [ ] **Step 1: Write the failing Deno tests**

Append to `supabase/functions/calculate-elo/achievements_test.ts`, and extend the import at the top to include `computeSeasonParticipation`, `computeSeasonPlacements`, `type SeasonRow`, `type SeasonStatRow`. Also add `season_id: "s1",` to `makeMatch`'s returned object (before `...overrides`).

```ts
// ---------------------------------------------------------------------------
// Season achievements
// ---------------------------------------------------------------------------

const ENDED = "2026-08-03T04:00:00.000Z";
const endedSeason = (id = "s1", ended_at: string | null = ENDED): SeasonRow => ({
  id,
  number: 1,
  started_at: "2026-05-30T00:00:00.000Z",
  ended_at,
});

// elos[i] belongs to player `p${i + 1}`; every player is ranked (3 games)
// unless `games` says otherwise.
function standings(
  elos: number[],
  games: number[] = elos.map(() => 3),
  season_id = "s1",
): SeasonStatRow[] {
  return elos.map((elo, i) => ({
    player_id: `p${i + 1}`,
    season_id,
    current_season_elo: elo,
    wins: games[i],
    losses: 0,
  }));
}

const placementIds = (
  seasons: SeasonRow[],
  stats: SeasonStatRow[],
  player: string,
) =>
  (computeSeasonPlacements(seasons, stats).get(player) ?? [])
    .map((u) => u.achievementId)
    .sort();

Deno.test("placements: 1st/2nd/3rd get their medal only, dated ended_at", () => {
  const stats = standings([1700, 1650, 1600, 1550, 1520, 1400]);
  const got = computeSeasonPlacements([endedSeason()], stats);
  assertEquals(got.get("p1"), [
    { achievementId: "season_net_positive", unlockedAt: new Date(ENDED), seasonId: "s1" },
    { achievementId: "season_top_1", unlockedAt: new Date(ENDED), seasonId: "s1" },
  ]);
  assertEquals(placementIds([endedSeason()], stats, "p2"), ["season_net_positive", "season_top_2"]);
  assertEquals(placementIds([endedSeason()], stats, "p3"), ["season_net_positive", "season_top_3"]);
  assertEquals(placementIds([endedSeason()], stats, "p4"), ["season_net_positive", "season_top_5"]);
});

Deno.test("placements: ties share a rank (1, 2, 2, 4)", () => {
  const stats = standings([1700, 1600, 1600, 1550, 1500, 1400]);
  assertEquals(placementIds([endedSeason()], stats, "p2"), ["season_net_positive", "season_top_2"]);
  assertEquals(placementIds([endedSeason()], stats, "p3"), ["season_net_positive", "season_top_2"]);
  assertEquals(placementIds([endedSeason()], stats, "p4"), ["season_net_positive", "season_top_5"]);
});

Deno.test("placements: a shared first place makes two champions", () => {
  const stats = standings([1700, 1700, 1600, 1550, 1500]);
  assertEquals(placementIds([endedSeason()], stats, "p1"), ["season_net_positive", "season_top_1"]);
  assertEquals(placementIds([endedSeason()], stats, "p2"), ["season_net_positive", "season_top_1"]);
  assertEquals(placementIds([endedSeason()], stats, "p3"), ["season_net_positive", "season_top_3"]);
});

Deno.test("placements: none below 5 ranked players, net positive still counts", () => {
  const stats = standings([1700, 1650, 1600, 1400]);
  assertEquals(placementIds([endedSeason()], stats, "p1"), ["season_net_positive"]);
  assertEquals(placementIds([endedSeason()], stats, "p4"), []);
});

Deno.test("placements: Top N needs more than N ranked players", () => {
  // Exactly 5 ranked: medals yes, High Five no (5 is not > 5).
  const five = standings([1700, 1650, 1600, 1450, 1400]);
  assertEquals(placementIds([endedSeason()], five, "p3"), ["season_net_positive", "season_top_3"]);
  assertEquals(placementIds([endedSeason()], five, "p4"), []);
  // 10 ranked: rank 7 gets nothing (Top Ten needs 11).
  const ten = standings([1900, 1850, 1800, 1750, 1700, 1650, 1450, 1400, 1350, 1300]);
  assertEquals(placementIds([endedSeason()], ten, "p7"), []);
  // 11 ranked: rank 7 gets Top Ten.
  const eleven = standings([1900, 1850, 1800, 1750, 1700, 1650, 1450, 1400, 1350, 1300, 1250]);
  assertEquals(placementIds([endedSeason()], eleven, "p7"), ["season_top_10"]);
});

Deno.test("placements: unranked players neither rank nor count toward the floor", () => {
  // p6 has the top rating but only 2 games: not ranked, and the season has
  // just 5 ranked players - p1 is champion.
  const stats = standings([1700, 1650, 1600, 1550, 1520, 1900], [3, 3, 3, 3, 3, 2]);
  assertEquals(placementIds([endedSeason()], stats, "p6"), []);
  assertEquals(placementIds([endedSeason()], stats, "p1"), ["season_net_positive", "season_top_1"]);
});

Deno.test("placements: net positive needs 1501, 1500 is not enough", () => {
  const stats = standings([1501, 1500, 1400, 1400, 1400]);
  assertEquals(placementIds([endedSeason()], stats, "p1").includes("season_net_positive"), true);
  assertEquals(placementIds([endedSeason()], stats, "p2").includes("season_net_positive"), false);
});

Deno.test("placements: the active season awards nothing", () => {
  const stats = standings([1700, 1650, 1600, 1550, 1520]);
  assertEquals(computeSeasonPlacements([endedSeason("s1", null)], stats).size, 0);
});

Deno.test("participation: unlocks at the 3rd match of a season, active or not", () => {
  const ms = [
    makeMatch(1, { season_id: "s1" }),
    makeMatch(2, { season_id: "s1" }),
    makeMatch(3, { season_id: "s2" }),
    makeMatch(4, { season_id: "s1" }),
    makeMatch(5, { season_id: "s2" }),
  ];
  assertEquals(computeSeasonParticipation("p1", ms), [
    { achievementId: "season_participated", unlockedAt: new Date(ms[3].created_at), seasonId: "s1" },
  ]);
});

Deno.test("meta achievements count distinct ids, not rows", () => {
  // Nine distinct achievements, plus the same seasonal one three times: 12
  // rows but 10 distinct ids - achievement_hunter unlocks with the first
  // season_top_1, not with a repeat.
  const matches = nineAchievementSeason();
  const first = new Date("2026-02-01T00:00:00Z");
  const extra = ["s1", "s2", "s3"].map((seasonId, i) => ({
    achievementId: "season_top_1" as const,
    unlockedAt: new Date(first.getTime() + i * 86_400_000),
    seasonId,
  }));
  const got = computeAchievementsForPlayer(
    "p1",
    { id: "p1" } as Parameters<typeof computeAchievementsForPlayer>[1],
    matches,
    [],
    [],
    null,
    extra,
  );
  const hunter = got.find((a) => a.achievementId === "achievement_hunter");
  assertEquals(hunter?.unlockedAt, first);
  // Two repeats don't reach 20 distinct.
  assertEquals(got.some((a) => a.achievementId === "completionist"), false);
});
```

Note: `nineAchievementSeason()` already exists in this file (used by the `linked_account` tests). Its matches are built with `makeMatch`, so they now carry `season_id: "s1"` - make sure it still yields exactly 9 achievements (the existing `assertEquals(unlinked.length, 9)` test proves it). If a `season_participated` now appears (≥ 3 matches in s1), give those matches `season_id: null` inside `nineAchievementSeason` so the existing tests keep their meaning.

- [ ] **Step 2: Run to verify they fail**

Run (from `supabase/functions/calculate-elo/`): `deno test -A achievements_test.ts`
Expected: FAIL - `computeSeasonParticipation`/`computeSeasonPlacements` not exported.

- [ ] **Step 3: Implement in `_shared/achievements.ts`**

1. Add the seven ids to `AchievementId`, after `"pair_goals_1000"`.
2. Export `UnlockedAchievement` and give it `seasonId?: string;` (comment: `/** Set on per-season achievements; one-time ones leave it out. */`).
3. Add `season_id: string | null;` to `Match`.
4. After the Goals section, add:

```ts
// ---------------------------------------------------------------------------
// Season achievements
// ---------------------------------------------------------------------------

/** Mirrors RANKED_MIN_GAMES in frontend/src/lib/rosterFilter.ts. */
export const RANKED_MIN_GAMES = 3;

export interface SeasonRow {
  id: string;
  number: number;
  started_at: string;
  ended_at: string | null;
}

export interface SeasonStatRow {
  player_id: string;
  season_id: string;
  current_season_elo: number;
  wins: number;
  losses: number;
}

/** A season needs this many ranked players before anyone gets a placement. */
const PLACEMENT_MIN_RANKED = 5;

// Best first. A tier is reached at rank <= n, and only awarded when the
// season had more than n ranked players (a Top 10 of 10 says nothing).
const PLACEMENT_TIERS: [AchievementId, number][] = [
  ["season_top_1", 1],
  ["season_top_2", 2],
  ["season_top_3", 3],
  ["season_top_5", 5],
  ["season_top_10", 10],
];

/**
 * On the Board: the player's 3rd match in each season, active seasons
 * included. `sorted` is the player's matches, oldest first.
 */
export function computeSeasonParticipation(
  playerId: string,
  sorted: Match[],
): UnlockedAchievement[] {
  const unlocked: UnlockedAchievement[] = [];
  const perSeason = new Map<string, number>();
  for (const m of sorted) {
    if (!m.season_id) continue;
    const involved =
      m.team_a_player_1_id === playerId ||
      m.team_a_player_2_id === playerId ||
      m.team_b_player_1_id === playerId ||
      m.team_b_player_2_id === playerId;
    if (!involved) continue;
    const n = (perSeason.get(m.season_id) ?? 0) + 1;
    perSeason.set(m.season_id, n);
    if (n === RANKED_MIN_GAMES) {
      unlocked.push({
        achievementId: "season_participated",
        unlockedAt: new Date(m.created_at),
        seasonId: m.season_id,
      });
    }
  }
  return unlocked;
}

/**
 * Final placements and In the Green, per player, from the stored standings of
 * every ended season. Ranked = RANKED_MIN_GAMES series in the season; ranks go
 * by season Elo with ties sharing a rank (1, 2, 2, 4). Placements need
 * PLACEMENT_MIN_RANKED ranked players, a Top N more than N, and only the best
 * tier is awarded. All dated at the season's end.
 */
export function computeSeasonPlacements(
  seasons: SeasonRow[],
  stats: SeasonStatRow[],
): Map<string, UnlockedAchievement[]> {
  const byPlayer = new Map<string, UnlockedAchievement[]>();
  const add = (playerId: string, u: UnlockedAchievement) => {
    const list = byPlayer.get(playerId);
    if (list) list.push(u);
    else byPlayer.set(playerId, [u]);
  };

  for (const season of seasons) {
    if (!season.ended_at) continue;
    const unlockedAt = new Date(season.ended_at);
    const ranked = stats.filter(
      (s) =>
        s.season_id === season.id && s.wins + s.losses >= RANKED_MIN_GAMES,
    );
    for (const s of ranked) {
      if (s.current_season_elo >= 1501) {
        add(s.player_id, {
          achievementId: "season_net_positive",
          unlockedAt,
          seasonId: season.id,
        });
      }
      if (ranked.length < PLACEMENT_MIN_RANKED) continue;
      const rank =
        1 +
        ranked.filter((o) => o.current_season_elo > s.current_season_elo)
          .length;
      const tier = PLACEMENT_TIERS.find(
        ([, n]) => rank <= n && ranked.length > n,
      );
      if (tier) {
        add(s.player_id, {
          achievementId: tier[0],
          unlockedAt,
          seasonId: season.id,
        });
      }
    }
  }
  return byPlayer;
}

/**
 * When the player's nth distinct achievement was first earned, or null.
 * Per-season achievements repeat, and a repeat is not a new achievement.
 */
function nthDistinctUnlock(
  unlocked: UnlockedAchievement[],
  n: number,
): Date | null {
  const seen = new Set<AchievementId>();
  const sorted = [...unlocked].sort(
    (a, b) => a.unlockedAt.getTime() - b.unlockedAt.getTime(),
  );
  for (const u of sorted) {
    if (seen.has(u.achievementId)) continue;
    seen.add(u.achievementId);
    if (seen.size === n) return u.unlockedAt;
  }
  return null;
}
```

Order caveat in the tiers: `season_top_2` at rank 2 with 2 ranked players can't happen (floor 5), so `ranked.length > n` only bites for 5 and 10 in practice, but keep it general.

5. `computeAchievementsForPlayer`: add the parameter after `linkedAt`:

```ts
  // Unlocks derived outside this player's matches (season placements, and
  // from #122 the award wins). They count toward the metas below.
  extra: UnlockedAchievement[] = [],
```

and, right after the `linked_account` push and before the metas:

```ts
  // On the Board - one per season with 3+ games
  unlocked.push(...computeSeasonParticipation(playerId, sorted));
  unlocked.push(...extra);
```

6. Replace the three meta blocks with:

```ts
  // Metas count distinct achievement ids, and each one counts the metas below
  // it - completionist includes achievement_hunter, and so on.
  const METAS: [AchievementId, number][] = [
    ["achievement_hunter", 10],
    ["completionist", 20],
    ["completionist_30", 30],
  ];
  for (const [id, n] of METAS) {
    const at = nthDistinctUnlock(unlocked, n);
    if (at) unlocked.push({ achievementId: id, unlockedAt: at });
  }
```

7. Replace the recompute section's signature and body:

```ts
export interface PlayerAccountLink {
  player_id: string;
  linked_at: string;
}

/**
 * Everything the recompute reads besides players and matches. The admin
 * recompute passes it in because it deletes every row first, and must not
 * discover a failing read only after that.
 */
export interface AchievementPreRead {
  links: PlayerAccountLink[];
  seasons: SeasonRow[];
  seasonStats: SeasonStatRow[];
}

async function readAchievementInputs(
  supabase: SupabaseClient,
): Promise<AchievementPreRead> {
  const [links, seasons, seasonStats] = await Promise.all([
    supabase.from("player_accounts").select("player_id, linked_at"),
    supabase.from("seasons").select("id, number, started_at, ended_at"),
    supabase
      .from("player_season_stats")
      .select("player_id, season_id, current_season_elo, wins, losses"),
  ]);
  // Throw rather than skip on a failed read, so no meta-achievement is written
  // with a date that ignores what couldn't be read.
  for (const r of [links, seasons, seasonStats]) if (r.error) throw r.error;
  return {
    links: (links.data ?? []) as PlayerAccountLink[],
    seasons: (seasons.data ?? []) as SeasonRow[],
    seasonStats: (seasonStats.data ?? []) as SeasonStatRow[],
  };
}

export async function recomputeAllAchievements(
  supabase: SupabaseClient,
  players: Player[],
  matches: Match[],
  pre?: AchievementPreRead,
): Promise<void> {
  const rows: {
    player_id: string;
    achievement_id: AchievementId;
    unlocked_at: string;
    meta: Record<string, unknown> | null;
    season_id: string | null;
  }[] = [];

  // ELO history feeds the day-swing and partner-gap achievements.
  const { data: eloHistory } = await supabase.from("elo_history").select("*");
  const history = (eloHistory ?? []) as EloHistory[];

  const { links, seasons, seasonStats } =
    pre ?? (await readAchievementInputs(supabase));
  const linkedAt = new Map<string, Date>(
    links.map((l) => [l.player_id, new Date(l.linked_at)]),
  );
  const placements = computeSeasonPlacements(seasons, seasonStats);

  for (const player of players) {
    const unlocked = computeAchievementsForPlayer(
      player.id,
      player,
      matches,
      players,
      history,
      linkedAt.get(player.id) ?? null,
      placements.get(player.id) ?? [],
    );
    for (const u of unlocked) {
      rows.push({
        player_id: player.id,
        achievement_id: u.achievementId,
        unlocked_at: u.unlockedAt.toISOString(),
        meta: u.meta ?? null,
        season_id: u.seasonId ?? null,
      });
    }
  }

  if (rows.length === 0) return;

  const { error } = await supabase.from("player_achievements").upsert(rows, {
    onConflict: "player_id,achievement_id,season_id",
    ignoreDuplicates: true,
  });

  if (error) throw error;
}
```

- [ ] **Step 4: Run tests, lint, typecheck**

Run (from `supabase/functions/calculate-elo/`): `deno test -A && deno lint && deno check index.ts`
Expected: all PASS (including the pre-existing linked_account and goal tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/achievements.ts supabase/functions/calculate-elo/achievements_test.ts
git commit -m "ELO-120: Derive season placements and participation"
```

---

### Task 3: Frontend mirror, definitions, strings, data layer

**Files:**
- Modify: `frontend/src/lib/achievements.ts`, `frontend/src/lib/achievements.test.ts`
- Modify: `frontend/src/lib/supabase.ts`
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/de.json`

**Interfaces:**
- Consumes: everything Task 2 produced (copy the same code).
- Produces: `PlayerAchievementRow.season_id: string | null`; `export async function recomputeAchievements(): Promise<void>` in `supabase.ts` (non-fatal, logs); `endSeasonAndStartNew` now recomputes after the RPC.

- [ ] **Step 1: Update the pre-read test to the new bundle (failing)**

In `frontend/src/lib/achievements.test.ts`, rename the describe to `"recomputeAllAchievements with pre-read inputs"`, and replace its body:

```ts
  it("uses the inputs it is given instead of reading them", async () => {
    // The admin recompute deletes every row before rebuilding, so it reads
    // links, seasons and standings first and hands them in: a failing read
    // then aborts before anything is deleted, rather than after.
    const upserted: {
      player_id: string;
      achievement_id: string;
      season_id: string | null;
    }[] = [];
    let conflictTarget = "";
    const client = {
      from: (table: string) => {
        if (["player_accounts", "seasons", "player_season_stats"].includes(table)) {
          throw new Error(`${table} must not be read`);
        }
        if (table === "elo_history") {
          return { select: async () => ({ data: [], error: null }) };
        }
        return {
          upsert: async (
            rows: typeof upserted,
            opts: { onConflict: string },
          ) => {
            upserted.push(...rows);
            conflictTarget = opts.onConflict;
            return { error: null };
          },
        };
      },
    } as unknown as SupabaseClient;

    const players = ["p1", "p2", "p3", "p4", "p5"].map(makePlayer);
    await recomputeAllAchievements(client, players, [], {
      links: [{ player_id: "p1", linked_at: "2026-09-20T10:00:00Z" }],
      seasons: [
        { id: "s1", number: 1, started_at: "2026-05-30T00:00:00Z", ended_at: "2026-08-03T00:00:00Z" },
      ],
      seasonStats: players.map((p, i) => ({
        player_id: p.id,
        season_id: "s1",
        current_season_elo: 1700 - i * 50,
        wins: 3,
        losses: 0,
      })),
    });

    expect(conflictTarget).toBe("player_id,achievement_id,season_id");
    expect(upserted).toContainEqual(
      expect.objectContaining({
        player_id: "p1",
        achievement_id: "linked_account",
        season_id: null,
      }),
    );
    expect(upserted).toContainEqual(
      expect.objectContaining({
        player_id: "p1",
        achievement_id: "season_top_1",
        season_id: "s1",
        unlocked_at: "2026-08-03T00:00:00.000Z",
      }),
    );
  });
```

Also add `season_id: null,` to the object built in this file's `makeMatch` helper if the `Match` type requires it (it already has `season_id` - check the helper compiles).

Run (from `frontend/`): `pnpm test -- achievements.test.ts`
Expected: FAIL (4th argument shape / no `season_top_1`).

- [ ] **Step 2: Mirror Task 2 into `frontend/src/lib/achievements.ts`**

Apply items 1, 2, 4, 5, 6, 7 of Task 2 Step 3 verbatim (the frontend `Match` comes from `./supabase` and already has `season_id`; `UnlockedAchievement` is already exported - just add `seasonId?`). In `recomputeAllAchievements` the row type stays `Omit<PlayerAchievementRow, "id">[]`. Then:

- `PlayerAchievementRow` gains `season_id: string | null;` (comment: `/** Set on per-season achievements, NULL on one-time ones. */`).
- Add to `ACHIEVEMENT_DEFINITIONS`, after `pair_goals_1000` and before `linked_account`:

```ts
  {
    id: "season_participated",
    icon: "📋",
    name: "On the Board",
    description: "Play 3 games in a season",
  },
  {
    id: "season_top_1",
    icon: "🏆",
    name: "Season Champion",
    description: "Finish a season in 1st place",
  },
  {
    id: "season_top_2",
    icon: "🥈",
    name: "Runner-Up",
    description: "Finish a season in 2nd place",
  },
  {
    id: "season_top_3",
    icon: "🥉",
    name: "Podium",
    description: "Finish a season in 3rd place",
  },
  {
    id: "season_top_5",
    icon: "🖐️",
    name: "High Five",
    description: "Finish a season in the top 5",
  },
  {
    id: "season_top_10",
    icon: "🔟",
    name: "Top Ten",
    description: "Finish a season in the top 10",
  },
  {
    id: "season_net_positive",
    icon: "💹",
    name: "In the Green",
    description: "Finish a season ranked, above 1500",
  },
```

- [ ] **Step 3: Strings**

`frontend/src/locales/en.json`, inside `achievementDefs` (after `pair_goals_1000`):

```json
    "season_participated": { "name": "On the Board", "description": "Play 3 games in a season" },
    "season_top_1": { "name": "Season Champion", "description": "Finish a season in 1st place" },
    "season_top_2": { "name": "Runner-Up", "description": "Finish a season in 2nd place" },
    "season_top_3": { "name": "Podium", "description": "Finish a season in 3rd place" },
    "season_top_5": { "name": "High Five", "description": "Finish a season in the top 5" },
    "season_top_10": { "name": "Top Ten", "description": "Finish a season in the top 10" },
    "season_net_positive": { "name": "In the Green", "description": "Finish a season ranked, above 1500" },
```

`de.json`:

```json
    "season_participated": { "name": "Mit von der Partie", "description": "Spiele 3 Partien in einer Saison" },
    "season_top_1": { "name": "Saisonsieger", "description": "Beende eine Saison auf Platz 1" },
    "season_top_2": { "name": "Vizemeister", "description": "Beende eine Saison auf Platz 2" },
    "season_top_3": { "name": "Podest", "description": "Beende eine Saison auf Platz 3" },
    "season_top_5": { "name": "High Five", "description": "Beende eine Saison unter den Top 5" },
    "season_top_10": { "name": "Top Ten", "description": "Beende eine Saison unter den Top 10" },
    "season_net_positive": { "name": "Im grünen Bereich", "description": "Beende eine Saison gewertet und über 1500" },
```

Match the existing formatting of `achievementDefs` entries in each file (multi-line objects if that's what's there).

- [ ] **Step 4: Data layer (`frontend/src/lib/supabase.ts`)**

1. Replace `recomputeAfterLinkChange` with a general non-fatal helper plus the unlink wrapper:

```ts
/**
 * Brings achievements in line with something that happened outside a match
 * (a link change, a season ending) without waiting for the next one. Only
 * adds: the recompute never deletes. Non-fatal: the change itself already
 * succeeded, and every recorded match recomputes anyway.
 */
export async function recomputeAchievements(): Promise<void> {
  try {
    const [players, matches] = await Promise.all([getPlayers(), getMatches()]);
    await recomputeAllAchievements(supabase, players, matches);
  } catch (err) {
    console.error("Achievement recompute failed:", err);
  }
}

/**
 * A link only ever adds (the RPC wrote That's Me!, a meta may now be due). An
 * unlink can take a meta away, but the recompute never deletes - so the
 * player's metas are dropped first and the recompute gives back the ones still
 * earned, with their original dates (admin-only, like every
 * player_achievements delete).
 */
async function recomputeAfterLinkChange(unlinkedPlayerId?: string) {
  if (unlinkedPlayerId) {
    const { error } = await supabase
      .from("player_achievements")
      .delete()
      .eq("player_id", unlinkedPlayerId)
      .in("achievement_id", META_ACHIEVEMENT_IDS);
    if (error) {
      console.error("Achievement recompute after link change failed:", error);
      return;
    }
  }
  await recomputeAchievements();
}
```

2. `endSeasonAndStartNew`: after `if (error) throw error;` add

```ts
  // Ending a season doesn't go through calculate-elo, so the placements it
  // just made final would otherwise wait for the next recorded match.
  await recomputeAchievements();
```

3. `recomputeAllAchievementsAdmin`: read the bundle before the delete:

```ts
  const [players, matches, links, seasons, seasonStats] = await Promise.all([
    getPlayers(),
    getMatches(),
    getAllPlayerAccounts(),
    getSeasons(),
    getAllPlayerSeasonStats(),
  ]);
  ...
  await recomputeAllAchievements(supabase, players, matches, {
    links,
    seasons,
    seasonStats,
  });
```

(`Season`/`PlayerSeasonStats` are structurally wider than `SeasonRow`/`SeasonStatRow`, so they pass as-is. `getAllPlayerAccounts` returns `PlayerAccount[]` which has `player_id` and `linked_at`.)

4. Delete `upsertPlayerAchievements` (no callers: `grep -rn upsertPlayerAchievements frontend/src` must print nothing afterwards).

- [ ] **Step 5: Run tests + lint**

Run (from `frontend/`): `pnpm test && pnpm lint`
Expected: PASS.

Then check drift between the two copies of the new code:
Run (repo root): `diff <(sed -n '/^\/\/ Season achievements/,/^function nthDistinctUnlock/p' supabase/functions/_shared/achievements.ts) <(sed -n '/^\/\/ Season achievements/,/^function nthDistinctUnlock/p' frontend/src/lib/achievements.ts)`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/achievements.ts frontend/src/lib/achievements.test.ts frontend/src/lib/supabase.ts frontend/src/locales/en.json frontend/src/locales/de.json
git commit -m "ELO-120: Season achievements in the frontend, recompute after a season ends"
```

---

### Task 4: Grouped display (×N, season tooltip, player-based rarity)

**Files:**
- Modify: `frontend/src/lib/achievements.ts` (`computeRarityMap`, `AchievementStatus`, `buildAchievementStatuses`)
- Modify: `frontend/src/components/Achievements.tsx`, `frontend/src/components/PlayerDetail.tsx`
- Modify: `frontend/src/lib/seasonStats.ts`, `frontend/src/lib/seasonStats.test.ts`
- Modify: locales
- Test: `frontend/src/lib/achievements.test.ts`

**Interfaces:**
- Produces: `AchievementStatus` += `count: number` (0 when locked) and `seasonIds: string[]` (seasons of the unlocks, oldest first; empty for one-time); `AchievementGallery` gains optional prop `seasons?: Season[]`.

- [ ] **Step 1: Write failing tests**

Append to `frontend/src/lib/achievements.test.ts` (add `buildAchievementStatuses`, `computeRarityMap`, `type PlayerAchievementRow` to the import):

```ts
describe("repeated per-season achievements", () => {
  const row = (
    player_id: string,
    achievement_id: PlayerAchievementRow["achievement_id"],
    season_id: string | null,
    unlocked_at: string,
  ): PlayerAchievementRow => ({
    id: `${player_id}-${achievement_id}-${season_id}`,
    player_id,
    achievement_id,
    season_id,
    unlocked_at,
    meta: null,
  });

  it("rarity counts players holding it, not rows", () => {
    const rows = [
      row("p1", "season_top_1", "s1", "2026-04-04T00:00:00Z"),
      row("p1", "season_top_1", "s2", "2026-05-30T00:00:00Z"),
      row("p2", "win_1", null, "2026-01-01T00:00:00Z"),
    ];
    const rarity = computeRarityMap(rows, 4);
    expect(rarity.get("season_top_1")).toBe(25);
    expect(rarity.get("win_1")).toBe(25);
  });

  it("groups one id into a single status with its count and seasons", () => {
    const rows = [
      row("p1", "season_top_1", "s2", "2026-05-30T00:00:00Z"),
      row("p1", "season_top_1", "s1", "2026-04-04T00:00:00Z"),
      row("p1", "win_1", null, "2026-01-01T00:00:00Z"),
    ];
    const statuses = buildAchievementStatuses("p1", makePlayer("p1"), [makePlayer("p1")], [], rows);
    const champ = statuses.find((s) => s.definition.id === "season_top_1")!;
    expect(champ.unlocked).toBe(true);
    expect(champ.count).toBe(2);
    expect(champ.seasonIds).toEqual(["s1", "s2"]);
    // The latest unlock, so "by date" surfaces a fresh placement.
    expect(champ.unlockedAt).toEqual(new Date("2026-05-30T00:00:00Z"));
    const win = statuses.find((s) => s.definition.id === "win_1")!;
    expect(win.count).toBe(1);
    expect(win.seasonIds).toEqual([]);
    const locked = statuses.find((s) => s.definition.id === "season_top_2")!;
    expect(locked.count).toBe(0);
  });
});
```

Run: `pnpm test -- achievements.test.ts` → FAIL (`count` undefined, rarity 50).

- [ ] **Step 2: Implement in `achievements.ts`**

`computeRarityMap`:

```ts
export function computeRarityMap(
  allRows: PlayerAchievementRow[],
  totalPlayers: number,
): Map<AchievementId, number> {
  // Players holding each id at least once: a per-season achievement won three
  // times is still one player holding it.
  const holders = new Map<AchievementId, Set<string>>();
  for (const row of allRows) {
    const set = holders.get(row.achievement_id);
    if (set) set.add(row.player_id);
    else holders.set(row.achievement_id, new Set([row.player_id]));
  }
  const rarityMap = new Map<AchievementId, number>();
  for (const [id, set] of holders) {
    rarityMap.set(id, totalPlayers > 0 ? (set.size / totalPlayers) * 100 : 0);
  }
  return rarityMap;
}
```

`AchievementStatus` gains:

```ts
  /** How many times it was unlocked; above 1 only for per-season ones. */
  count: number;
  /** The seasons it was unlocked in, oldest first; empty for one-time ones. */
  seasonIds: string[];
```

In `buildAchievementStatuses`, replace the `ACHIEVEMENT_DEFINITIONS.map` body's row lookup:

```ts
  return ACHIEVEMENT_DEFINITIONS.map((def) => {
    const defRows = playerRows
      .filter((r) => r.achievement_id === def.id)
      .sort((a, b) => a.unlocked_at.localeCompare(b.unlocked_at));
    const row = defRows[defRows.length - 1];
    const liveEntries = liveUnlocked.filter((u) => u.achievementId === def.id);
    const liveEntry = liveEntries[liveEntries.length - 1];
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
      count: defRows.length || liveEntries.length,
      seasonIds: defRows.length
        ? defRows.flatMap((r) => (r.season_id ? [r.season_id] : []))
        : liveEntries.flatMap((u) => (u.seasonId ? [u.seasonId] : [])),
      rarityPercent,
      rarityTier,
    };
  });
```

`computeClientSideRarityMap` counts `(player, id)` once: wrap the inner loop in a per-player `Set<AchievementId>` so a repeated id isn't counted twice.

Run the tests → PASS.

- [ ] **Step 3: UI**

`Achievements.tsx`:

1. `AchievementGalleryProps` += `seasons?: Season[];` (import `Season` type from `../lib/supabase`), pass `seasons` through to each unlocked `AchievementCard` (`seasons={seasons}`).
2. `AchievementCardProps` += `seasons?: Season[];`. In `AchievementCard`, after `unlockedLabel`:

```tsx
  // Per-season achievements list where they were won, e.g. "Season 2, Season 4".
  const seasonNames =
    !locked && status.seasonIds.length > 0
      ? status.seasonIds
          .map((id) => seasons?.find((s) => s.id === id))
          .map((s) =>
            s ? t("achievements.seasonLabel", { number: s.number }) : "?",
          )
          .join(", ")
      : undefined;
```

Give the root `<div>` `title={seasonNames}`, and render the count next to the name:

```tsx
      <div className="achievement-name">
        {t(`achievementDefs.${definition.id}.name`, definition.name)}
        {!locked && status.count > 1 && (
          <span className="achievement-count"> ×{status.count}</span>
        )}
      </div>
```

3. `AchievementsOverview`'s `addAchiever`: return early if the player is already listed for that id, so a triple champion appears once in the bubble:

```ts
  const addAchiever = (achievementId: string, player: Player) => {
    const ids = achieverIdsById.get(achievementId);
    if (ids?.has(player.id)) return;
    ...existing body...
  };
```

4. `PlayerDetail.tsx` at the `<AchievementGallery` call (~line 874): add `seasons={seasons}`.

5. `App.css`: next to the `.achievement-name` rule add

```css
.achievement-count {
  font-weight: 500;
  opacity: 0.75;
}
```

Strings - `achievements.seasonLabel`: en `"Season {{number}}"`, de `"Saison {{number}}"`.

- [ ] **Step 4: Season Stats count by season**

`frontend/src/lib/seasonStats.ts`, the per-season branch of `achievementsUnlocked`:

```ts
        ? achievements.filter((a) =>
            // A per-season row belongs to its season - placements are dated
            // the season's end, which is also the next season's start.
            a.season_id
              ? a.season_id === seasonId
              : a.unlocked_at >= seasonBounds.startedAt &&
                (seasonBounds.endedAt == null ||
                  a.unlocked_at < seasonBounds.endedAt),
          ).length
```

Add a test to `frontend/src/lib/seasonStats.test.ts` following the file's existing `computeSeasonStats` call style: a row `{ achievement_id: "season_top_1", season_id: "s1", unlocked_at: <s1.ended_at> }` counts for s1 and not for s2 (whose `startedAt` equals s1's `endedAt`). Existing test rows in that file need `season_id: null` added if the type now requires it.

- [ ] **Step 5: Run everything**

Run (from `frontend/`): `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: tests + lint PASS; tsc shows only the pre-existing `Leaderboard.tsx` errors (see CLAUDE.md "Type checking").

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "ELO-120: Group repeated achievements (xN, seasons tooltip, rarity per player)"
```

---

### Task 5: Visual check

- [ ] **Step 1:** Run the `run` skill (or `pnpm dev` from `frontend/` against staging) and, signed in, open Achievements → Overview and a player's detail. Locally the seasonal ids show as locked until Task 6 migrates staging and a recompute runs. After Task 6, revisit: a player with repeated placements shows `×N` and the season tooltip, in light, dark and Win95.

---

### Task 6: Staging, docs, changeset

**Files:**
- Modify: `CLAUDE.md`
- Create: `.changeset/season-achievements.md`

- [ ] **Step 1: Apply the migration to staging**

```bash
S=<scratchpad>/staging   # linked workdir, see memory "supabase-environments"
supabase db query --linked --workdir $S -f "$(pwd)/supabase/migrations/20260930_season_achievements.sql"
```

- [ ] **Step 2: Verify the key on staging (rolled back)**

```sql
BEGIN;
-- one-time rows still dedupe (NULL = NULL under NULLS NOT DISTINCT)
INSERT INTO player_achievements (player_id, achievement_id, unlocked_at, season_id)
SELECT id, 'zz_test', now(), NULL FROM players LIMIT 1;
INSERT INTO player_achievements (player_id, achievement_id, unlocked_at, season_id)
SELECT id, 'zz_test', now(), NULL FROM players LIMIT 1
ON CONFLICT (player_id, achievement_id, season_id) DO NOTHING;
-- the same id in two seasons is two rows
INSERT INTO player_achievements (player_id, achievement_id, unlocked_at, season_id)
SELECT p.id, 'zz_test', now(), s.id FROM (SELECT id FROM players LIMIT 1) p, seasons s
ON CONFLICT (player_id, achievement_id, season_id) DO NOTHING;
SELECT season_id IS NULL AS one_time, count(*) FROM player_achievements
WHERE achievement_id = 'zz_test' GROUP BY 1;
ROLLBACK;
```

Expected: `one_time = true` → 1, `one_time = false` → number of seasons.

Then re-run `supabase/scripts/player-accounts-checks.sql` (it claims inside a rolled-back transaction, exercising the re-created `link_player_account`). Expected: every check passes, as on 2026-09-27.

- [ ] **Step 3: Deploy calculate-elo to staging and recompute**

```bash
supabase functions deploy calculate-elo --use-api --project-ref kitwrozsauxcwcycxibb
```

Then, in the frontend against staging as admin: Admin → Recompute achievements. Query:

```sql
SELECT s.number, pa.achievement_id, count(*)
FROM player_achievements pa JOIN seasons s ON s.id = pa.season_id
GROUP BY 1, 2 ORDER BY 1, 2;
```

Expected: seasons 1-3 show placements where they had ≥ 5 ranked players, `season_net_positive`, and `season_participated`; season 4 (active) only `season_participated`. Sanity-check one season's `season_top_1` against its stored standings:

```sql
SELECT p.name, pss.current_season_elo, pss.wins + pss.losses AS games
FROM player_season_stats pss JOIN players p ON p.id = pss.player_id
WHERE pss.season_id = (SELECT id FROM seasons WHERE number = 3)
  AND pss.wins + pss.losses >= 3
ORDER BY pss.current_season_elo DESC;
```

- [ ] **Step 4: CLAUDE.md**

- In the `frontend/src/lib/achievements.ts` bullet, add: per-season achievements carry `seasonId` → `player_achievements.season_id`; placements come from `computeSeasonPlacements` over stored `player_season_stats` of ended seasons (≥ 5 ranked, Top N needs > N, best tier only, ties share a rank), On the Board from matches; metas count distinct ids; rarity counts players; `recomputeAllAchievements` takes a pre-read `{ links, seasons, seasonStats }` bundle, which the admin recompute reads before its delete; ending a season runs a non-destructive recompute (`endSeasonAndStartNew`).
- In Database Schema, `player_achievements`: add `season_id` (NULL = one-time) and the `UNIQUE NULLS NOT DISTINCT (player_id, achievement_id, season_id)` key; any `ON CONFLICT` on this table must name all three columns (the link RPC does); release order migration → calculate-elo → frontend.

- [ ] **Step 5: Changeset**

`.changeset/season-achievements.md`:

```md
---
"toegg-elo-frontend": minor
---

Season achievements: earn On the Board, a podium or top-ten finish and In the Green again every season - repeated ones show as ×N.

Adds `player_achievements.season_id` with a `NULLS NOT DISTINCT` unique key; apply `20260930_season_achievements.sql` before deploying calculate-elo and the frontend.
```

- [ ] **Step 6: Full verification + commit**

Run: `cd frontend && pnpm lint && pnpm test` and `cd supabase/functions/calculate-elo && deno lint && deno test -A && deno check index.ts`
Expected: all PASS.

```bash
git add CLAUDE.md .changeset/season-achievements.md
git commit -m "ELO-120: Document season achievements"
```

- [ ] **Step 7: PR**

Push `elo-120-season-achievements` and open a PR "ELO-120: Season achievements" closing #120. Body: summary, the release order, and the unchecked prod steps (check `server_version` ≥ 15, apply migration, deploy calculate-elo, Admin → Recompute). **Prod steps wait for the user's approval.**
