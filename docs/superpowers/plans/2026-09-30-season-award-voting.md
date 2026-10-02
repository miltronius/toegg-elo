# Season Award Voting (#121) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Linked players vote on seven Season Awards, from a week before a season's planned end until two weeks into the next season. Each ballot is secret, and picks can be changed until voting closes. Results are #122.

**Architecture:** The migration adds `seasons.planned_end_at` and `voting_opened_at`, plus a `season_award_votes` table with no write path except the SECURITY DEFINER `cast_award_vote`. That RPC enforces the window, eligibility and the no-self-vote rule. A pure `lib/seasonAwards.ts` mirrors the window and eligibility rules, so the UI never offers a pick the server would refuse. App builds one `AwardVoteNudge` and slots it into Timeline and Season Stats; clicking it opens `AwardBallotDialog`, which App renders. Admins set the planned end when starting a season, edit it on the running season, and can "Open voting now".

**Tech Stack:** Supabase Postgres 17, React 19 + TS, TanStack Query, react-i18next, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-09-24-player-linking-and-season-awards-design.md`, section 4a and "Cross-cutting rules". Issue: miltronius/toegg-elo#121.

## Global Constraints

- Awards, in ballot order (id · icon · en · de · nominees):
  - `award_offense` · ⚔️ · Best Offensive Player · Bester Stürmer · ranked
  - `award_defense` · 🛡️ · Best Defender - The Wall · Bester Verteidiger - Die Wand · ranked
  - `award_fun` · 🎉 · Most Fun to Play With · Grösster Spassfaktor · ranked
  - `award_community` · 🤝 · Community Award · Community-Preis · ranked
  - `award_improved` · 🚀 · Most Improved · Grösster Fortschritt · ranked
  - `award_rookie` · 🌱 · Rookie of the Season · Rookie der Saison · ranked in S, never ranked in an earlier season
  - `award_guest` · 🎟️ · Special Guest · Stargast · played 1-2 games in S (not ranked)
- Ranked = at least `RANKED_MIN_GAMES` (3) games in the season, counted as `player_season_stats.wins + losses`. That is the same count the Leaderboard's 🏅 and `computeSeasonPlacements` use.
- Voting window for season S (half-open, `[opens, closes)`):
  - **Opens** at the earliest of `voting_opened_at`, `planned_end_at − 7 days` and S's `ended_at`.
  - **Closes** at the next season's (`number + 1`) `started_at + 14 days`.
  - `AWARD_VOTING_LEAD_DAYS = 7` and `AWARD_VOTING_TAIL_DAYS = 14`. The SQL writes them as `168 hours` and `336 hours`, because the TS works in milliseconds and a days INTERVAL follows DST.
- Secret ballot: a voter reads only their own rows. Nobody else reads any vote, **admins included**. There are no direct writes.
- RPC errors are bare codes in the message: `not_allowed`, `voter_not_linked`, `unknown_award`, `voting_not_open`, `self_vote`, `nominee_not_eligible`, `season_not_active`.
- Role checks use `COALESCE(get_my_role(), '')`, because `get_my_role()` is NULL for a logged-out caller. New client-callable functions `REVOKE ... FROM PUBLIC, anon`; internal helpers also revoke `authenticated`.
- TS uses `"`. German uses Swiss spelling (`ss`). In German, *Spiel* is a match/series and *Partie* a single game, so "3+ games" in the ranked sense is "ab 3 Spielen".
- Dates display through `DATE_LOCALE`. The planned-end field is Swiss text (`dd.mm.yyyy hh:mm`, via `maskSwissDateTime`/`parseSwissDateTime` from `lib/banners.ts`), never a native date picker.
- Dialogs carry `modal-panel`, with the heading as the first child, so Win95 styles them.
- Commits: **no `Co-Authored-By` trailer** (user preference, which overrides the harness default).
- Staging (`kitwrozsauxcwcycxibb`, which the repo is linked to) may be migrated and checked freely. **Prod needs the user's explicit approval.** If the auto-mode classifier blocks a staging SQL call (it blocked a rolled-back probe while this plan was written), stop and ask the user.
- **Release order:** migration, then frontend. `calculate-elo` is untouched.

## Decisions made while planning (not in the spec - review these)

1. **`end_season_and_start_new`'s admin guard is broken today, and this migration fixes it.** It checks `IF get_my_role() <> 'admin'`, which is NULL for a logged-out caller, so the IF doesn't fire. On staging, `anon` holds EXECUTE on it (checked with `has_function_privilege`; the exploit itself was not run). So the anon key in the bundle can most likely end the season. The migration DROPs and re-creates the function anyway for `new_planned_end_at`, so the new version uses `COALESCE` and revokes `anon`. **`set_banner_order` has the same flaw, and `apply_inactivity_penalties` has no role check at all (anon holds EXECUTE on both).** Both are outside this ticket. I recommend a separate hotfix before #121 ships.
2. Eligibility reads `player_season_stats` on both sides, the same source as the 🏅 badge and the placements. That way the ballot and the RPC can't disagree.
3. "Open voting now" is an RPC (`open_award_voting`): it uses server time, only works on the running season, is idempotent and has no undo. The planned end is a plain admin UPDATE (existing RLS), backed by `CHECK (planned_end_at > started_at)`.
4. `awards_finalized_at` is #122's column. `awardVotingStatus` already reads it as an optional field, so the `finalized` status the ticket names exists now.
5. Votes get their own TanStack query (`["awardVotes", userId]`) rather than joining `fetchAppData`. Only the nudge and the ballot read them, and a pick shouldn't refetch the whole dashboard. They're not realtime. The ballot only renders once they have loaded.
6. The ballot saves each pick as it's made; there's no submit button. That is what "changeable until close, skipping allowed" needs.
7. There is one nudge per open season, normally just one. While a season is still running, its close date isn't known yet, so the nudge says "closes 14 days into the next season".
8. The nudge in Season Stats ignores the scope select. Otherwise voting for the season that just ended would hide behind the default "running season" scope. #122's results section is the part that follows the scope.
9. Viewers and visitors see no nudge; "Link your player" is only shown to roles that can claim one. A linked account that has been demoted to viewer also sees none, since the RPC would refuse it.
10. `season_award_votes` has the composite primary key `(season_id, award_id, voter_user_id)` rather than a surrogate id plus UNIQUE.
11. The defender's tagline is part of the name ("Best Defender - The Wall"), not a separate italic string.
12. Deleting a player cascades their nominations. Unlinking or demoting a voter keeps the votes they cast. The spec is silent here, so #122 can decide whether finalisation drops them.

## Review Focus

1. **A guest who plays their 3rd game after being picked as Special Guest** → the ballot keeps showing the pick with a warning instead of blanking it, and the server refuses a fresh pick of them. Pinned by the ballot test "keeps a pick who no longer qualifies visible" (Task 4) and the SQL check "guest award refuses a ranked player" (Task 1).
2. **The exact window edges** → client and server agree that voting is open from exactly planned end − 7 days and closed from exactly next start + 14 days. Pinned by the Vitest boundary tests (Task 2) and the SQL edge checks, which rely on `now()` being fixed for the whole transaction (Task 1).
3. **The anon key calling the RPCs directly** → refused, including `end_season_and_start_new`. Pinned by SQL checks (Task 1).
4. **Two ballots open at once** (the next season's voting opened early, within two weeks of its start) → one nudge per season, and each ballot is scoped to its own season. Pinned by the `seasonsOpenForVoting` overlap test (Task 2) and the nudge test "shows one nudge per open ballot" (Task 3).
5. **A save that fails** (network, or voting closed while the ballot was open) → the picker reverts to the stored pick and says why. Pinned by the ballot test "puts a refused pick back" (Task 4).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260930_season_award_voting.sql` (new) | seasons columns + CHECK, fixed `end_season_and_start_new`, `open_award_voting`, window/eligibility helpers, `season_award_votes`, `cast_award_vote` |
| `supabase/scripts/season-award-voting-checks.sql` (new) | every server rule, inside a rolled-back transaction |
| `frontend/src/lib/seasonAwards.ts` (+ `.test.ts`) (new) | awards, window, status, eligibility, access, planned-end parsing, error keys |
| `frontend/src/lib/supabase.ts` | `Season` fields, vote + schedule data functions |
| `frontend/src/components/AwardVoteNudge.tsx` (+ test) (new) | the "🗳️ Vote" nudge |
| `frontend/src/components/AwardBallotDialog.tsx` (+ test) (new) | the ballot |
| `frontend/src/components/SeasonScheduleAdmin.tsx` (+ test) (new) | admin planned end + Open voting now |
| `frontend/src/components/SeasonDialog.tsx` | planned end on a new season, schedule rows, admin block, nudge slot |
| `frontend/src/components/Timeline.tsx`, `SeasonStats.tsx` | `awardNudge` slot |
| `frontend/src/App.tsx` | votes query, nudge, ballot |
| `frontend/src/App.css` | nudge / ballot / schedule styles |
| `frontend/src/locales/{en,de}.json` | strings |
| `CLAUDE.md`, `.changeset/season-award-voting.md` | docs, minor changeset |

---

### Task 1: Migration + server-side checks

**Files:**
- Create: `supabase/scripts/season-award-voting-checks.sql`
- Create: `supabase/migrations/20260930_season_award_voting.sql`

**Interfaces:**
- Produces (SQL):
  - `seasons.planned_end_at TIMESTAMPTZ NULL` and `seasons.voting_opened_at TIMESTAMPTZ NULL`
  - `end_season_and_start_new(TEXT, INTEGER, NUMERIC, NUMERIC DEFAULT 0.25, TIMESTAMPTZ DEFAULT NULL)`
  - `open_award_voting(p_season_id UUID)`
  - `cast_award_vote(p_season_id UUID, p_award_id TEXT, p_nominee_player_id UUID)`
  - table `season_award_votes(season_id, award_id, voter_user_id, nominee_player_id, updated_at)`
  - internal `award_voting_is_open(UUID)` and `award_nominee_eligible(UUID, TEXT, UUID)` (#122's finalisation reuses both)

- [ ] **Step 1: Write the checks (the failing test)**

`supabase/scripts/season-award-voting-checks.sql`:

```sql
-- Rule checks for Season Awards voting (#121). Runs inside a transaction that
-- is always rolled back: fixtures, season edits and votes all disappear.
-- Usage (repo root, linked to staging):
--   supabase db query --linked -f <abs path to this file>
-- now() is fixed for the whole transaction, which is what lets the window
-- edges be checked to the exact moment.
BEGIN;

-- Fixture ids: u(n) = account, p(n) = player.
CREATE FUNCTION pg_temp.u(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000c00' || n)::uuid $$;
CREATE FUNCTION pg_temp.p(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000d00' || n)::uuid $$;
CREATE FUNCTION pg_temp.active() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT id FROM seasons WHERE is_active $$;

-- Accounts: 1 user (linked to player 1), 2 admin (linked to player 5),
-- 3 viewer, 4 user without a player. auth.users inserts fire handle_new_user.
INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'vote-check-' || n || '@test.invalid' FROM generate_series(1, 4) n;
UPDATE profiles SET role = 'user'  WHERE id IN (pg_temp.u(1), pg_temp.u(4));
UPDATE profiles SET role = 'admin' WHERE id = pg_temp.u(2);

-- Players (on_player_created gives each a 0-game row in the running season):
-- 1 = user 1's own, ranked; 2 = ranked for the first time (rookie too);
-- 3 = one game (guest); 4 = ranked now and in an earlier season;
-- 5 = the admin's, ranked; 6 = no games.
INSERT INTO players (id, name)
SELECT pg_temp.p(n), 'Vote Check ' || n FROM generate_series(1, 6) n;
INSERT INTO player_accounts (player_id, user_id) VALUES
  (pg_temp.p(1), pg_temp.u(1)),
  (pg_temp.p(5), pg_temp.u(2));
UPDATE player_season_stats SET wins = 2, losses = 1
 WHERE season_id = pg_temp.active()
   AND player_id IN (pg_temp.p(1), pg_temp.p(2), pg_temp.p(4), pg_temp.p(5));
UPDATE player_season_stats SET wins = 1
 WHERE season_id = pg_temp.active() AND player_id = pg_temp.p(3);
INSERT INTO player_season_stats (player_id, season_id, elo_at_start, current_season_elo, wins, losses)
SELECT pg_temp.p(4), id, 1500, 1500, 3, 0
  FROM seasons WHERE NOT is_active ORDER BY number DESC LIMIT 1;

-- act as: pass a user id, or NULL for a logged-out (anon) caller
CREATE FUNCTION pg_temp.act_as(uid UUID) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    CASE WHEN uid IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', uid, 'role', 'authenticated')::text END,
    true);
$$;

-- expect(label, sql, code): run sql, require it to fail with exactly `code`
-- (NULL = must succeed).
CREATE FUNCTION pg_temp.expect(label TEXT, stmt TEXT, code TEXT) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF code IS NULL OR SQLERRM <> code THEN
      RAISE EXCEPTION 'FAIL %: expected %, got %', label, COALESCE(code, 'success'), SQLERRM;
    END IF;
    RAISE NOTICE 'ok   %', label;
    RETURN;
  END;
  IF code IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL %: expected %, got success', label, code;
  END IF;
  RAISE NOTICE 'ok   %', label;
END;
$$;

CREATE FUNCTION pg_temp.expect_count(label TEXT, q TEXT, n BIGINT) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE got BIGINT;
BEGIN
  EXECUTE q INTO got;
  IF got IS DISTINCT FROM n THEN
    RAISE EXCEPTION 'FAIL %: expected %, got %', label, n, got;
  END IF;
  RAISE NOTICE 'ok   %', label;
END;
$$;

-- The running season's window inputs, plus an optional next season
-- (number + 1) that started at next_started. Run as the owner (RESET ROLE).
CREATE FUNCTION pg_temp.shape(opened TIMESTAMPTZ, planned TIMESTAMPTZ,
                              ended TIMESTAMPTZ, next_started TIMESTAMPTZ)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_number INT;
BEGIN
  SELECT number INTO v_number FROM seasons WHERE is_active;
  UPDATE seasons SET voting_opened_at = opened, planned_end_at = planned, ended_at = ended
   WHERE is_active;
  DELETE FROM seasons WHERE number = v_number + 1;
  IF next_started IS NOT NULL THEN
    INSERT INTO seasons (number, name, started_at, is_active)
    VALUES (v_number + 1, 'Vote Check next', next_started, false);
  END IF;
END;
$$;

-- vote(award, nominee): cast in the running season as whoever act_as set.
CREATE FUNCTION pg_temp.vote(award TEXT, nominee UUID) RETURNS void LANGUAGE sql AS $$
  SELECT cast_award_vote(pg_temp.active(), award, nominee) $$;

-- ── Who may call ─────────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT pg_temp.act_as(NULL);
SELECT pg_temp.expect('anon cannot vote', $q$SELECT pg_temp.vote('award_offense', pg_temp.p(2))$q$, 'permission denied for function cast_award_vote');
SELECT pg_temp.expect('anon cannot open voting', $q$SELECT open_award_voting(pg_temp.active())$q$, 'permission denied for function open_award_voting');
SELECT pg_temp.expect('anon cannot end the season', $q$SELECT end_season_and_start_new('Vote Check', 48, 0, 0.25)$q$, 'permission denied for function end_season_and_start_new');
SELECT pg_temp.expect_count('anon reads no votes', 'SELECT count(*) FROM season_award_votes', 0);

RESET ROLE;
SELECT pg_temp.shape(NULL, now() + interval '30 days', NULL, NULL);  -- opens in 23 days
SET LOCAL ROLE authenticated;

SELECT pg_temp.act_as(pg_temp.u(3));
SELECT pg_temp.expect('viewer cannot vote', $q$SELECT pg_temp.vote('award_offense', pg_temp.p(2))$q$, 'not_allowed');
SELECT pg_temp.act_as(pg_temp.u(4));
SELECT pg_temp.expect('unlinked user cannot vote', $q$SELECT pg_temp.vote('award_offense', pg_temp.p(2))$q$, 'voter_not_linked');
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('not open yet', $q$SELECT pg_temp.vote('award_offense', pg_temp.p(2))$q$, 'voting_not_open');
SELECT pg_temp.expect('user cannot open voting', $q$SELECT open_award_voting(pg_temp.active())$q$, 'not_allowed');
SELECT pg_temp.expect('user cannot end the season', $q$SELECT end_season_and_start_new('Vote Check', 48, 0, 0.25)$q$, 'Only admins can end seasons');
SELECT pg_temp.expect('window helper not callable', $q$SELECT award_voting_is_open(pg_temp.active())$q$, 'permission denied for function award_voting_is_open');
SELECT pg_temp.expect('eligibility helper not callable', $q$SELECT award_nominee_eligible(pg_temp.active(), 'award_offense', pg_temp.p(2))$q$, 'permission denied for function award_nominee_eligible');

SELECT pg_temp.act_as(pg_temp.u(2));
SELECT pg_temp.expect('only the running season opens early', $q$SELECT open_award_voting((SELECT id FROM seasons WHERE NOT is_active ORDER BY number DESC LIMIT 1))$q$, 'season_not_active');
SELECT pg_temp.expect('admin opens voting', $q$SELECT open_award_voting(pg_temp.active())$q$, NULL);
SELECT pg_temp.expect('opening twice is a no-op', $q$SELECT open_award_voting(pg_temp.active())$q$, NULL);
SELECT pg_temp.expect_count('opened at server time', 'SELECT count(*) FROM seasons WHERE is_active AND voting_opened_at = now()', 1);

-- ── Picks ────────────────────────────────────────────────────
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('vote once opened', $q$SELECT pg_temp.vote('award_offense', pg_temp.p(2))$q$, NULL);
SELECT pg_temp.expect('no self-vote', $q$SELECT pg_temp.vote('award_offense', pg_temp.p(1))$q$, 'self_vote');
SELECT pg_temp.expect('a guest is not ranked', $q$SELECT pg_temp.vote('award_offense', pg_temp.p(3))$q$, 'nominee_not_eligible');
SELECT pg_temp.expect('no games, no nomination', $q$SELECT pg_temp.vote('award_offense', pg_temp.p(6))$q$, 'nominee_not_eligible');
SELECT pg_temp.expect('guest award takes a guest', $q$SELECT pg_temp.vote('award_guest', pg_temp.p(3))$q$, NULL);
SELECT pg_temp.expect('guest award refuses a ranked player', $q$SELECT pg_temp.vote('award_guest', pg_temp.p(2))$q$, 'nominee_not_eligible');
SELECT pg_temp.expect('guest award refuses no games', $q$SELECT pg_temp.vote('award_guest', pg_temp.p(6))$q$, 'nominee_not_eligible');
SELECT pg_temp.expect('rookie award takes a first-time ranked player', $q$SELECT pg_temp.vote('award_rookie', pg_temp.p(2))$q$, NULL);
SELECT pg_temp.expect('rookie award refuses a veteran', $q$SELECT pg_temp.vote('award_rookie', pg_temp.p(4))$q$, 'nominee_not_eligible');
SELECT pg_temp.expect('unknown award', $q$SELECT pg_temp.vote('award_bogus', pg_temp.p(2))$q$, 'unknown_award');
SELECT pg_temp.expect('unknown season', $q$SELECT cast_award_vote(gen_random_uuid(), 'award_offense', pg_temp.p(2))$q$, 'voting_not_open');
SELECT pg_temp.expect('change a pick', $q$SELECT pg_temp.vote('award_offense', pg_temp.p(4))$q$, NULL);
SELECT pg_temp.expect_count('a change replaces the pick', $q$SELECT count(*) FROM season_award_votes WHERE award_id = 'award_offense' AND nominee_player_id = pg_temp.p(4)$q$, 1);
SELECT pg_temp.expect_count('one row per award', $q$SELECT count(*) FROM season_award_votes WHERE award_id = 'award_offense'$q$, 1);
SELECT pg_temp.expect('clear a pick', $q$SELECT pg_temp.vote('award_offense', NULL)$q$, NULL);
SELECT pg_temp.expect_count('voter reads own ballot', 'SELECT count(*) FROM season_award_votes', 2);
SELECT pg_temp.expect('no direct insert', $q$INSERT INTO season_award_votes (season_id, award_id, voter_user_id, nominee_player_id) VALUES (pg_temp.active(), 'award_fun', pg_temp.u(1), pg_temp.p(2))$q$, 'permission denied for table season_award_votes');
SELECT pg_temp.expect('no direct delete', $q$DELETE FROM season_award_votes WHERE true$q$, 'permission denied for table season_award_votes');

-- ── Secret ballot ────────────────────────────────────────────
SELECT pg_temp.act_as(pg_temp.u(2));
SELECT pg_temp.expect('admin votes too', $q$SELECT pg_temp.vote('award_offense', pg_temp.p(2))$q$, NULL);
SELECT pg_temp.expect_count('admin reads only their own votes', 'SELECT count(*) FROM season_award_votes', 1);
SELECT pg_temp.act_as(pg_temp.u(4));
SELECT pg_temp.expect_count('others read nothing', 'SELECT count(*) FROM season_award_votes', 0);

-- ── Window edges (user 1 re-picks the guest, who stays eligible) ──
RESET ROLE;
SELECT pg_temp.shape(NULL, now() + interval '168 hours', NULL, NULL);
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('opens exactly 7 days before the planned end', $q$SELECT pg_temp.vote('award_guest', pg_temp.p(3))$q$, NULL);

RESET ROLE;
SELECT pg_temp.shape(NULL, now() + interval '168 hours 1 second', NULL, NULL);
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('not a second earlier', $q$SELECT pg_temp.vote('award_guest', pg_temp.p(3))$q$, 'voting_not_open');

RESET ROLE;
SELECT pg_temp.shape(NULL, NULL, NULL, NULL);
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('nothing set, nothing open', $q$SELECT pg_temp.vote('award_guest', pg_temp.p(3))$q$, 'voting_not_open');

RESET ROLE;
SELECT pg_temp.shape(now(), NULL, NULL, NULL);
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('opened this instant counts', $q$SELECT pg_temp.vote('award_guest', pg_temp.p(3))$q$, NULL);

RESET ROLE;
SELECT pg_temp.shape(NULL, NULL, now() - interval '1 hour', now() - interval '1 hour');
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('the end opens it without a plan', $q$SELECT pg_temp.vote('award_guest', pg_temp.p(3))$q$, NULL);

RESET ROLE;
SELECT pg_temp.shape(NULL, NULL, now() - interval '20 days', now() - interval '336 hours' + interval '1 second');
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('open until 14 days into the next season', $q$SELECT pg_temp.vote('award_guest', pg_temp.p(3))$q$, NULL);

RESET ROLE;
SELECT pg_temp.shape(NULL, NULL, now() - interval '20 days', now() - interval '336 hours');
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('closed at exactly 14 days', $q$SELECT pg_temp.vote('award_guest', pg_temp.p(3))$q$, 'voting_not_open');
SELECT pg_temp.expect('a closed ballot cannot be cleared either', $q$SELECT pg_temp.vote('award_guest', NULL)$q$, 'voting_not_open');

-- ── Starting a season with a planned end ─────────────────────
RESET ROLE;
SELECT pg_temp.shape(NULL, NULL, NULL, NULL);
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(2));
SELECT pg_temp.expect_count('end_season_and_start_new has one signature', $q$SELECT count(*) FROM pg_proc WHERE proname = 'end_season_and_start_new'$q$, 1);
SELECT pg_temp.expect('a planned end before the start is refused', $q$SELECT end_season_and_start_new('Vote Check', 48, 0, 0.25, now() - interval '1 day')$q$, 'new row for relation "seasons" violates check constraint "seasons_planned_end_after_start"');
SELECT pg_temp.expect('admin starts a season with a planned end', $q$SELECT end_season_and_start_new('Vote Check', 48, 0, 0.25, now() + interval '60 days')$q$, NULL);
SELECT pg_temp.expect_count('planned end stored', $q$SELECT count(*) FROM seasons WHERE is_active AND planned_end_at = now() + interval '60 days'$q$, 1);
SELECT pg_temp.expect('the 4-argument call still works', $q$SELECT end_season_and_start_new('Vote Check 2', 48, 0, 0.25)$q$, NULL);
SELECT pg_temp.expect_count('...with no planned end', $q$SELECT count(*) FROM seasons WHERE is_active AND name = 'Vote Check 2' AND planned_end_at IS NULL$q$, 1);

RESET ROLE;
SELECT 'season award voting: all checks passed' AS result;
ROLLBACK;
```

- [ ] **Step 2: Run it against staging to see it fail**

Run (repo root): `supabase db query --linked -f "D:/dev/toegg-elo/supabase/scripts/season-award-voting-checks.sql"`
Expected: an error, because the migration isn't applied yet: `function cast_award_vote(...) does not exist` from `CREATE FUNCTION pg_temp.vote`, or a missing-column error from `pg_temp.shape`. Nothing persists; it rolls back.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260930_season_award_voting.sql`:

```sql
-- Season Awards voting (#121). Linked players vote on seven fixed awards from a
-- week before a season's planned end until two weeks into the next season; the
-- tally, winners and banner are #122.
--
-- Adds the season's planned end and the admin's "Open voting now", the secret
-- ballot table, and the RPCs that are the only way to write it. The window and
-- the eligibility rules are mirrored in frontend/src/lib/seasonAwards.ts -
-- change both together.
--
-- Safe to re-run: these are applied by hand in the SQL editor.
--
-- Release order: apply this before the frontend. The new SeasonDialog passes
-- end_season_and_start_new a fifth argument; the old frontend keeps working,
-- since that argument defaults to NULL.

-- ============================================================
-- 1. Seasons: planned end + early opening
-- ============================================================
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS planned_end_at   TIMESTAMPTZ;
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS voting_opened_at TIMESTAMPTZ;

ALTER TABLE seasons DROP CONSTRAINT IF EXISTS seasons_planned_end_after_start;
ALTER TABLE seasons ADD CONSTRAINT seasons_planned_end_after_start
  CHECK (planned_end_at IS NULL OR planned_end_at > started_at);

-- ============================================================
-- 2. end_season_and_start_new takes the new season's planned end
-- ============================================================
-- Dropped rather than replaced: adding a parameter would create an overload and
-- leave the 4-argument version callable.
--
-- The admin check changes too. The old `IF get_my_role() <> 'admin'` let a
-- logged-out caller through: get_my_role() is NULL for them, `NULL <> 'admin'`
-- is NULL, and IF treats NULL as false - while anon held EXECUTE through
-- Supabase's default privileges. So the anon key in the bundle could end the
-- season.
DROP FUNCTION IF EXISTS end_season_and_start_new(TEXT, INTEGER, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION end_season_and_start_new(
  new_season_name     TEXT,
  new_k_factor        INTEGER,
  new_penalty_percent NUMERIC,
  new_partner_weight  NUMERIC DEFAULT 0.25,
  new_planned_end_at  TIMESTAMPTZ DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_id     UUID;
  v_old_number INTEGER;
  v_new_id     UUID;
BEGIN
  IF COALESCE(get_my_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can end seasons';
  END IF;

  SELECT id, number INTO v_old_id, v_old_number FROM seasons WHERE is_active = true;
  IF v_old_id IS NULL THEN
    RAISE EXCEPTION 'No active season found';
  END IF;

  UPDATE seasons SET is_active = false, ended_at = NOW() WHERE id = v_old_id;

  -- A planned end at or before NOW() fails seasons_planned_end_after_start.
  INSERT INTO seasons (number, name, k_factor, inactivity_penalty_percent,
                       partner_weight, planned_end_at, started_at, is_active)
  VALUES (v_old_number + 1, new_season_name, new_k_factor, new_penalty_percent,
          new_partner_weight, new_planned_end_at, NOW(), true)
  RETURNING id INTO v_new_id;

  -- All-time stats (players.current_elo, wins, losses) are NOT touched.
  -- Season starts normalized at 1500; elo_at_start records where each player actually was.
  INSERT INTO player_season_stats
    (player_id, season_id, elo_at_start, current_season_elo, wins, losses)
  SELECT id, v_new_id, current_elo, 1500, 0, 0 FROM players;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION end_season_and_start_new(TEXT, INTEGER, NUMERIC, NUMERIC, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION end_season_and_start_new(TEXT, INTEGER, NUMERIC, NUMERIC, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- 3. "Open voting now"
-- ============================================================
-- An RPC rather than a client-side UPDATE so the moment is server time: the
-- window cast_award_vote enforces is measured against now() here too.
CREATE OR REPLACE FUNCTION open_award_voting(p_season_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(get_my_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  -- Only the running season: an ended one opened when it ended. COALESCE keeps
  -- the first opening, so a second click changes nothing.
  UPDATE seasons SET voting_opened_at = COALESCE(voting_opened_at, now())
   WHERE id = p_season_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'season_not_active';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION open_award_voting(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION open_award_voting(UUID) TO authenticated;

-- ============================================================
-- 4. The window and who may be nominated (internal; #122 reuses both)
-- ============================================================
-- Mirrors awardVotingStatus in lib/seasonAwards.ts: open from the earliest of
-- "Open voting now", 7 days before the planned end, and the actual end, until
-- 14 days into the next season. LEAST ignores NULLs; nothing set at all is not
-- open. Fixed hours, not days: the TS works in milliseconds, and an INTERVAL
-- in days would follow DST in the session time zone.
CREATE OR REPLACE FUNCTION award_voting_is_open(p_season_id UUID)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
           now() >= LEAST(s.voting_opened_at,
                          s.planned_end_at - INTERVAL '168 hours',  -- AWARD_VOTING_LEAD_DAYS
                          s.ended_at)
           AND (nx.started_at IS NULL
                OR now() < nx.started_at + INTERVAL '336 hours'),  -- AWARD_VOTING_TAIL_DAYS
           false)
    FROM seasons s
    LEFT JOIN seasons nx ON nx.number = s.number + 1
   WHERE s.id = p_season_id;
$$;

-- Mirrors eligibleNomineeIds in lib/seasonAwards.ts. Games are series from
-- player_season_stats, the count the Leaderboard's ranked badge uses;
-- 3 = RANKED_MIN_GAMES. Only called with an award id already checked.
CREATE OR REPLACE FUNCTION award_nominee_eligible(p_season_id UUID, p_award_id TEXT, p_player_id UUID)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH g AS (
    SELECT COALESCE((SELECT wins + losses FROM player_season_stats
                      WHERE player_id = p_player_id AND season_id = p_season_id), 0) AS n
  )
  SELECT CASE
           WHEN p_award_id = 'award_guest' THEN g.n BETWEEN 1 AND 2
           WHEN p_award_id = 'award_rookie' THEN g.n >= 3 AND NOT EXISTS (
             SELECT 1
               FROM player_season_stats pss
               JOIN seasons earlier ON earlier.id = pss.season_id
              WHERE pss.player_id = p_player_id
                AND pss.wins + pss.losses >= 3
                AND earlier.number < (SELECT number FROM seasons WHERE id = p_season_id))
           ELSE g.n >= 3
         END
    FROM g;
$$;

-- Supabase's default privileges grant EXECUTE on new public functions to
-- anon/authenticated; these are only for the SECURITY DEFINER callers.
REVOKE ALL ON FUNCTION award_voting_is_open(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION award_nominee_eligible(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 5. The secret ballot
-- ============================================================
CREATE TABLE IF NOT EXISTS season_award_votes (
  season_id         UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  -- SEASON_AWARDS in lib/seasonAwards.ts; cast_award_vote repeats the list.
  award_id          TEXT NOT NULL CHECK (award_id IN (
                      'award_offense', 'award_defense', 'award_fun', 'award_community',
                      'award_improved', 'award_rookie', 'award_guest')),
  voter_user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  nominee_player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, award_id, voter_user_id)
);

CREATE INDEX IF NOT EXISTS idx_season_award_votes_voter
  ON season_award_votes(voter_user_id);
CREATE INDEX IF NOT EXISTS idx_season_award_votes_nominee
  ON season_award_votes(nominee_player_id);

ALTER TABLE season_award_votes ENABLE ROW LEVEL SECURITY;

-- Your own ballot only. Deliberately no admin clause: nobody reads anyone
-- else's votes, admins included. #122 tallies them inside a SECURITY DEFINER
-- function.
DROP POLICY IF EXISTS "Voters read their own ballot" ON season_award_votes;
CREATE POLICY "Voters read their own ballot" ON season_award_votes
  FOR SELECT USING (voter_user_id = (SELECT auth.uid()));

-- No write policies, and no write grants either: cast_award_vote is the only
-- way in. Not added to the realtime publication.
REVOKE INSERT, UPDATE, DELETE ON season_award_votes FROM anon, authenticated;

-- ============================================================
-- 6. cast_award_vote
-- ============================================================
-- One pick per (season, award, voter); NULL clears it. Refuses with a bare code
-- the frontend translates (lib/seasonAwards.ts AWARD_ERROR_CODES).
CREATE OR REPLACE FUNCTION cast_award_vote(p_season_id UUID, p_award_id TEXT, p_nominee_player_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_awards CONSTANT TEXT[] := ARRAY[
    'award_offense', 'award_defense', 'award_fun', 'award_community',
    'award_improved', 'award_rookie', 'award_guest'];
  v_voter     UUID := auth.uid();
  v_my_player UUID;
BEGIN
  -- COALESCE: get_my_role() is NULL for a logged-out caller, and NULL NOT IN
  -- (...) is NULL, which IF treats as false.
  IF COALESCE(get_my_role(), '') NOT IN ('user', 'admin') THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  SELECT player_id INTO v_my_player FROM player_accounts WHERE user_id = v_voter;
  IF v_my_player IS NULL THEN
    RAISE EXCEPTION 'voter_not_linked';
  END IF;
  IF p_award_id IS NULL OR NOT (p_award_id = ANY (c_awards)) THEN
    RAISE EXCEPTION 'unknown_award';
  END IF;
  -- Before the NULL branch: once voting closes a ballot is frozen, clears too.
  IF NOT COALESCE(award_voting_is_open(p_season_id), false) THEN
    RAISE EXCEPTION 'voting_not_open';
  END IF;

  IF p_nominee_player_id IS NULL THEN
    DELETE FROM season_award_votes
     WHERE season_id = p_season_id AND award_id = p_award_id AND voter_user_id = v_voter;
    RETURN;
  END IF;
  IF p_nominee_player_id = v_my_player THEN
    RAISE EXCEPTION 'self_vote';
  END IF;
  -- Live: the season may still be running. #122 re-checks at the close.
  IF NOT award_nominee_eligible(p_season_id, p_award_id, p_nominee_player_id) THEN
    RAISE EXCEPTION 'nominee_not_eligible';
  END IF;

  INSERT INTO season_award_votes (season_id, award_id, voter_user_id, nominee_player_id)
  VALUES (p_season_id, p_award_id, v_voter, p_nominee_player_id)
  ON CONFLICT (season_id, award_id, voter_user_id)
  DO UPDATE SET nominee_player_id = EXCLUDED.nominee_player_id, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION cast_award_vote(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cast_award_vote(UUID, TEXT, UUID) TO authenticated;
```

- [ ] **Step 4: Apply to staging, then run the checks until they pass**

```bash
supabase db query --linked -f "D:/dev/toegg-elo/supabase/migrations/20260930_season_award_voting.sql"
supabase db query --linked -f "D:/dev/toegg-elo/supabase/scripts/season-award-voting-checks.sql"
```

Expected: the last result row is `season award voting: all checks passed`. On a `FAIL <label>: expected …, got …`, fix the migration, re-apply it (it's re-runnable) and re-run the checks. Then confirm the grants outside the transaction:

```sql
SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('end_season_and_start_new', 'open_award_voting', 'cast_award_vote',
                    'award_voting_is_open', 'award_nominee_eligible');
```

Expected: `anon_exec = false` on all five.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260930_season_award_voting.sql supabase/scripts/season-award-voting-checks.sql
git commit -m "ELO-121: Season award voting schema, RPCs and staging checks"
```

---

### Task 2: `lib/seasonAwards.ts`

**Files:**
- Create: `frontend/src/lib/seasonAwards.ts`
- Create: `frontend/src/lib/seasonAwards.test.ts`
- Modify: `frontend/src/lib/supabase.ts` (the `Season` type)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/de.json`

**Interfaces:**
- Consumes: `RANKED_MIN_GAMES` (`lib/rosterFilter.ts`), `parseSwissDateTime` and `ParsedMoment` (`lib/banners.ts`), `Me` (`lib/playerLinking.ts`)
- Produces:
  - `AWARD_VOTING_LEAD_DAYS = 7`, `AWARD_VOTING_TAIL_DAYS = 14`
  - `type AwardId`, `type AwardNominees = "ranked" | "rookie" | "guest"`, `type SeasonAward = { id; icon; nominees }`, `SEASON_AWARDS: readonly SeasonAward[]`
  - `type AwardVote = { season_id; award_id: AwardId; voter_user_id; nominee_player_id; updated_at }`
  - `type AwardSeason`, `type AwardVotingStatus = "not_open" | "open" | "closed" | "finalized"`
  - `nextSeasonOf(season, seasons): T | null`
  - `awardVotingWindow(season, nextSeason): { opensAt: number | null; closesAt: number | null }`
  - `awardVotingStatus(season, nextSeason, now): AwardVotingStatus`
  - `seasonsOpenForVoting(seasons, now): T[]`
  - `eligibleNomineeIds(award, season, seasons, seasonStats): Set<string>`
  - `type BallotAccess = "vote" | "link" | "none"`, `ballotAccess(me): BallotAccess`
  - `picksForSeason(votes, seasonId): Partial<Record<AwardId, string>>`
  - `type PlannedEnd`, `parsePlannedEnd(text, startedAtMs): PlannedEnd`
  - `AWARD_ERROR_CODES`, `awardErrorKey(error): string | null`
  - `Season.planned_end_at?` and `Season.voting_opened_at?`

- [ ] **Step 1: Write the failing tests**

`frontend/src/lib/seasonAwards.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import de from "../locales/de.json";
import {
  AWARD_ERROR_CODES,
  AWARD_VOTING_LEAD_DAYS,
  AWARD_VOTING_TAIL_DAYS,
  SEASON_AWARDS,
  awardErrorKey,
  awardVotingStatus,
  awardVotingWindow,
  ballotAccess,
  eligibleNomineeIds,
  nextSeasonOf,
  parsePlannedEnd,
  picksForSeason,
  seasonsOpenForVoting,
  type AwardId,
  type AwardSeason,
  type AwardVote,
} from "./seasonAwards";

const DAY = 86_400_000;
const T0 = Date.parse("2026-10-01T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

function season(over: Partial<AwardSeason> = {}): AwardSeason {
  return {
    number: 5,
    started_at: iso(T0 - 60 * DAY),
    ended_at: null,
    planned_end_at: null,
    voting_opened_at: null,
    ...over,
  };
}
const next = (startedMs: number) => ({ started_at: iso(startedMs) });
const award = (id: AwardId) => SEASON_AWARDS.find((a) => a.id === id)!;

describe("constants", () => {
  it("mirror the SQL window (168 and 336 hours)", () => {
    expect(AWARD_VOTING_LEAD_DAYS).toBe(7);
    expect(AWARD_VOTING_TAIL_DAYS).toBe(14);
  });

  it("list the seven awards in ballot order, as the award_id CHECK does", () => {
    expect(SEASON_AWARDS.map((a) => a.id)).toEqual([
      "award_offense",
      "award_defense",
      "award_fun",
      "award_community",
      "award_improved",
      "award_rookie",
      "award_guest",
    ]);
  });

  it("name every award and explain every error in English and German", () => {
    for (const locale of [en, de]) {
      for (const a of SEASON_AWARDS) {
        expect(locale.seasonAwards.awards[a.id]).toBeTruthy();
      }
      for (const code of AWARD_ERROR_CODES) {
        expect(locale.seasonAwards.errors[code]).toBeTruthy();
      }
    }
  });
});

describe("awardVotingWindow", () => {
  it("has no opening while nothing is set, and no close without a next season", () => {
    expect(awardVotingWindow(season(), null)).toEqual({ opensAt: null, closesAt: null });
  });

  it("opens a lead week before the planned end", () => {
    expect(awardVotingWindow(season({ planned_end_at: iso(T0) }), null).opensAt).toBe(
      T0 - 7 * DAY,
    );
  });

  it("opens at the earliest of the three triggers", () => {
    const s = season({
      voting_opened_at: iso(T0 - 20 * DAY),
      planned_end_at: iso(T0),
      ended_at: iso(T0 - DAY),
    });
    expect(awardVotingWindow(s, null).opensAt).toBe(T0 - 20 * DAY);
    expect(awardVotingWindow({ ...s, voting_opened_at: null }, null).opensAt).toBe(
      T0 - 7 * DAY,
    );
    expect(
      awardVotingWindow({ ...s, voting_opened_at: null, ended_at: iso(T0 - 10 * DAY) }, null)
        .opensAt,
    ).toBe(T0 - 10 * DAY);
  });

  it("closes two weeks into the next season", () => {
    expect(awardVotingWindow(season({ ended_at: iso(T0) }), next(T0)).closesAt).toBe(
      T0 + 14 * DAY,
    );
  });

  it("ignores an unparseable timestamp", () => {
    expect(awardVotingWindow(season({ planned_end_at: "soon" }), null).opensAt).toBeNull();
  });
});

describe("awardVotingStatus", () => {
  const planned = season({ planned_end_at: iso(T0) });

  it("is not_open while nothing opens it", () => {
    expect(awardVotingStatus(season(), null, T0)).toBe("not_open");
  });

  it("opens exactly lead days before the planned end", () => {
    expect(awardVotingStatus(planned, null, T0 - 7 * DAY - 1)).toBe("not_open");
    expect(awardVotingStatus(planned, null, T0 - 7 * DAY)).toBe("open");
  });

  it("opens the moment an admin opens it", () => {
    const s = season({ voting_opened_at: iso(T0) });
    expect(awardVotingStatus(s, null, T0 - 1)).toBe("not_open");
    expect(awardVotingStatus(s, null, T0)).toBe("open");
  });

  it("opens when the season ends, even with no planned end", () => {
    const s = season({ ended_at: iso(T0) });
    expect(awardVotingStatus(s, next(T0), T0 - 1)).toBe("not_open");
    expect(awardVotingStatus(s, next(T0), T0)).toBe("open");
  });

  it("stays open while the season runs past its planned end", () => {
    expect(awardVotingStatus(planned, null, T0 + 30 * DAY)).toBe("open");
  });

  it("closes exactly tail days into the next season", () => {
    const s = season({ ended_at: iso(T0) });
    expect(awardVotingStatus(s, next(T0), T0 + 14 * DAY - 1)).toBe("open");
    expect(awardVotingStatus(s, next(T0), T0 + 14 * DAY)).toBe("closed");
  });

  it("reports finalized once #122 has tallied it, whatever the clock", () => {
    const s = { ...season({ ended_at: iso(T0) }), awards_finalized_at: iso(T0 + 15 * DAY) };
    expect(awardVotingStatus(s, next(T0), T0)).toBe("finalized");
  });
});

describe("seasonsOpenForVoting", () => {
  // S4 ended at T0, when S5 started: S4's ballot runs until T0 + 14 days.
  const s4 = { ...season({ number: 4, ended_at: iso(T0) }), id: "s4" };
  const s5 = { ...season({ number: 5, started_at: iso(T0) }), id: "s5" };

  it("finds the next season by number", () => {
    expect(nextSeasonOf(s4, [s5, s4])).toBe(s5);
    expect(nextSeasonOf(s5, [s5, s4])).toBeNull();
  });

  it("lists the seasons whose ballot is open right now", () => {
    expect(seasonsOpenForVoting([s5, s4], T0 + DAY).map((s) => s.id)).toEqual(["s4"]);
    expect(seasonsOpenForVoting([s5, s4], T0 + 14 * DAY)).toEqual([]);
  });

  it("lists overlapping ballots oldest first", () => {
    const early = { ...s5, voting_opened_at: iso(T0 + DAY) };
    expect(seasonsOpenForVoting([early, s4], T0 + 2 * DAY).map((s) => s.id)).toEqual([
      "s4",
      "s5",
    ]);
  });
});

describe("eligibleNomineeIds", () => {
  const seasons = [
    { id: "s3", number: 3 },
    { id: "s4", number: 4 },
    { id: "s5", number: 5 },
  ];
  const s4 = seasons[1];
  const row = (player_id: string, season_id: string, games: number) => ({
    player_id,
    season_id,
    wins: games,
    losses: 0,
  });
  const stats = [
    row("ranked", "s4", 3),
    row("veteran", "s4", 5),
    row("veteran", "s3", 3),
    row("almost", "s4", 4),
    row("almost", "s3", 2), // played before but was never ranked: still a rookie
    row("later", "s4", 3),
    row("later", "s5", 9), // a later season doesn't count against a rookie
    row("guest1", "s4", 1),
    row("guest2", "s4", 2),
    row("idle", "s4", 0),
    row("elsewhere", "s3", 7), // no row in s4 at all
  ];
  const ids = (id: AwardId) => [...eligibleNomineeIds(award(id), s4, seasons, stats)].sort();

  it("takes players with RANKED_MIN_GAMES games in the season for ranked awards", () => {
    expect(ids("award_offense")).toEqual(["almost", "later", "ranked", "veteran"]);
  });

  it("counts losses as games too", () => {
    const only = [{ player_id: "x", season_id: "s4", wins: 0, losses: 3 }];
    expect([...eligibleNomineeIds(award("award_fun"), s4, seasons, only)]).toEqual(["x"]);
  });

  it("takes rookies ranked now and never ranked before", () => {
    expect(ids("award_rookie")).toEqual(["almost", "later", "ranked"]);
  });

  it("takes guests who played, but too little to be ranked", () => {
    expect(ids("award_guest")).toEqual(["guest1", "guest2"]);
  });
});

describe("ballotAccess", () => {
  it("lets a linked user or admin vote", () => {
    expect(ballotAccess({ role: "user", myPlayerId: "p1" })).toBe("vote");
    expect(ballotAccess({ role: "admin", myPlayerId: "p1" })).toBe("vote");
  });

  it("asks an unlinked user or admin to link first", () => {
    expect(ballotAccess({ role: "user", myPlayerId: null })).toBe("link");
    expect(ballotAccess({ role: "admin", myPlayerId: null })).toBe("link");
  });

  it("offers viewers and visitors nothing, even a linked viewer", () => {
    expect(ballotAccess({ role: null, myPlayerId: null })).toBe("none");
    expect(ballotAccess({ role: "viewer", myPlayerId: null })).toBe("none");
    expect(ballotAccess({ role: "viewer", myPlayerId: "p1" })).toBe("none");
  });
});

describe("picksForSeason", () => {
  it("maps one season's votes by award", () => {
    const vote = (season_id: string, award_id: AwardId, nominee_player_id: string): AwardVote => ({
      season_id,
      award_id,
      nominee_player_id,
      voter_user_id: "u1",
      updated_at: iso(T0),
    });
    expect(
      picksForSeason(
        [vote("s5", "award_fun", "p2"), vote("s4", "award_fun", "p9"), vote("s5", "award_guest", "p3")],
        "s5",
      ),
    ).toEqual({ award_fun: "p2", award_guest: "p3" });
  });
});

describe("parsePlannedEnd", () => {
  // Local time, like the field.
  const start = new Date(2026, 9, 1, 12, 0).getTime();

  it("passes empty and invalid text through", () => {
    expect(parsePlannedEnd("", start)).toEqual({ kind: "empty" });
    expect(parsePlannedEnd("31.02.2026", start)).toEqual({ kind: "invalid" });
  });

  it("refuses an end at or before the start", () => {
    expect(parsePlannedEnd("01.10.2026 12:00", start)).toEqual({ kind: "before_start" });
    expect(parsePlannedEnd("30.09.2026", start)).toEqual({ kind: "before_start" });
  });

  it("accepts a later moment", () => {
    expect(parsePlannedEnd("01.10.2026 12:01", start)).toEqual({
      kind: "ok",
      iso: new Date(2026, 9, 1, 12, 1).toISOString(),
    });
  });
});

describe("awardErrorKey", () => {
  it("maps the RPC codes to translation keys and nothing else", () => {
    expect(awardErrorKey({ message: "self_vote" })).toBe("seasonAwards.errors.self_vote");
    expect(awardErrorKey(new Error("Failed to fetch"))).toBeNull();
    expect(awardErrorKey("self_vote")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd frontend && pnpm exec vitest run src/lib/seasonAwards.test.ts`
Expected: FAIL. `Failed to resolve import "./seasonAwards"`.

- [ ] **Step 3: Implement**

`frontend/src/lib/seasonAwards.ts`:

```ts
/**
 * Season Awards voting (#121): which awards exist, when a season's ballot is
 * open, and who may be nominated. The tally and winners are #122.
 *
 * The server enforces all of this in cast_award_vote
 * (20260930_season_award_voting.sql); everything here mirrors it so the ballot
 * never offers a pick the server would refuse. Change both together.
 *
 * Every decision is a pure function of `(data, now)`: a window opening changes
 * nothing in the database, so no realtime event ever announces it.
 *
 * Pure helpers only - no DB calls, no React.
 */
import { parseSwissDateTime, type ParsedMoment } from "./banners";
import type { Me } from "./playerLinking";
import { RANKED_MIN_GAMES } from "./rosterFilter";
import type { PlayerSeasonStats, Season } from "./supabase";

/** Voting opens this long before a season's planned end (SQL: 168 hours). */
export const AWARD_VOTING_LEAD_DAYS = 7;
/** ...and closes this long after the next season starts (SQL: 336 hours). */
export const AWARD_VOTING_TAIL_DAYS = 14;

const DAY_MS = 86_400_000;

export type AwardId =
  | "award_offense"
  | "award_defense"
  | "award_fun"
  | "award_community"
  | "award_improved"
  | "award_rookie"
  | "award_guest";

/**
 * Who can be nominated:
 * `ranked` - at least RANKED_MIN_GAMES games in the season.
 * `rookie` - ranked in the season, and never ranked in an earlier one.
 * `guest` - played in the season, but too little to be ranked.
 */
export type AwardNominees = "ranked" | "rookie" | "guest";

export type SeasonAward = { id: AwardId; icon: string; nominees: AwardNominees };

/**
 * Fixed in code by design, in ballot order. Names are translated
 * (`seasonAwards.awards.<id>`). The ids are also the CHECK list on
 * season_award_votes.award_id and cast_award_vote's list.
 */
export const SEASON_AWARDS: readonly SeasonAward[] = [
  { id: "award_offense", icon: "⚔️", nominees: "ranked" },
  { id: "award_defense", icon: "🛡️", nominees: "ranked" },
  { id: "award_fun", icon: "🎉", nominees: "ranked" },
  { id: "award_community", icon: "🤝", nominees: "ranked" },
  { id: "award_improved", icon: "🚀", nominees: "ranked" },
  { id: "award_rookie", icon: "🌱", nominees: "rookie" },
  { id: "award_guest", icon: "🎟️", nominees: "guest" },
];

/** One pick on the caller's ballot, as RLS returns it (own rows only). */
export type AwardVote = {
  season_id: string;
  award_id: AwardId;
  voter_user_id: string;
  nominee_player_id: string;
  updated_at: string;
};

/** The season fields the window reads. `awards_finalized_at` arrives with #122. */
export type AwardSeason = Pick<
  Season,
  "number" | "started_at" | "ended_at" | "planned_end_at" | "voting_opened_at"
> & { awards_finalized_at?: string | null };

export type AwardVotingStatus = "not_open" | "open" | "closed" | "finalized";

/** Unparseable or absent timestamps count as "not set" rather than throwing. */
function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** The season after `season`, which is what closes its ballot. */
export function nextSeasonOf<T extends Pick<Season, "number">>(
  season: Pick<Season, "number">,
  seasons: T[],
): T | null {
  return seasons.find((s) => s.number === season.number + 1) ?? null;
}

/**
 * When a season's ballot opens and closes, in ms. It opens at the earliest of
 * the admin's "Open voting now", a lead week before the planned end, and the
 * actual end (so every season gets a vote); null while none is set. It closes
 * two weeks into the next season; null while there is none yet.
 */
export function awardVotingWindow(
  season: AwardSeason,
  nextSeason: Pick<Season, "started_at"> | null,
): { opensAt: number | null; closesAt: number | null } {
  const plannedEnd = parseTime(season.planned_end_at);
  const triggers = [
    parseTime(season.voting_opened_at),
    plannedEnd === null ? null : plannedEnd - AWARD_VOTING_LEAD_DAYS * DAY_MS,
    parseTime(season.ended_at),
  ].filter((t): t is number => t !== null);
  const nextStart = nextSeason ? parseTime(nextSeason.started_at) : null;
  return {
    opensAt: triggers.length > 0 ? Math.min(...triggers) : null,
    closesAt: nextStart === null ? null : nextStart + AWARD_VOTING_TAIL_DAYS * DAY_MS,
  };
}

/** Half-open like the SQL: open from `opensAt` (inclusive) to `closesAt` (exclusive). */
export function awardVotingStatus(
  season: AwardSeason,
  nextSeason: Pick<Season, "started_at"> | null,
  now: number,
): AwardVotingStatus {
  if (season.awards_finalized_at) return "finalized";
  const { opensAt, closesAt } = awardVotingWindow(season, nextSeason);
  if (closesAt !== null && now >= closesAt) return "closed";
  if (opensAt === null || now < opensAt) return "not_open";
  return "open";
}

/**
 * Seasons whose ballot is open at `now`, oldest first (it closes first).
 * Normally one; two overlap only when a new season's voting is opened within
 * two weeks of its start.
 */
export function seasonsOpenForVoting<T extends AwardSeason & Pick<Season, "id">>(
  seasons: T[],
  now: number,
): T[] {
  return seasons
    .filter((s) => awardVotingStatus(s, nextSeasonOf(s, seasons), now) === "open")
    .sort((a, b) => a.number - b.number);
}

type StatsRow = Pick<PlayerSeasonStats, "player_id" | "season_id" | "wins" | "losses">;

const gamesOf = (row: StatsRow) => row.wins + row.losses;

/**
 * Who may be nominated for `award` in `season`, by player id. Live: during the
 * first voting week the season is still running, so this can change - the
 * server re-checks every vote, and #122 again at the close.
 *
 * Games are series from player_season_stats (wins + losses), the same count
 * the Leaderboard's ranked badge and the season placements use.
 */
export function eligibleNomineeIds(
  award: SeasonAward,
  season: Pick<Season, "id" | "number">,
  seasons: Pick<Season, "id" | "number">[],
  seasonStats: StatsRow[],
): Set<string> {
  const ids = new Set<string>();
  for (const row of seasonStats) {
    if (row.season_id !== season.id) continue;
    const games = gamesOf(row);
    const ranked = games >= RANKED_MIN_GAMES;
    if (award.nominees === "guest" ? games >= 1 && !ranked : ranked) {
      ids.add(row.player_id);
    }
  }
  if (award.nominees === "rookie") {
    const earlier = new Set(
      seasons.filter((s) => s.number < season.number).map((s) => s.id),
    );
    for (const row of seasonStats) {
      if (earlier.has(row.season_id) && gamesOf(row) >= RANKED_MIN_GAMES) {
        ids.delete(row.player_id);
      }
    }
  }
  return ids;
}

/**
 * `vote` - a linked user/admin. `link` - a user/admin who could vote once they
 * claim their player. `none` - viewers and visitors, who can't claim either
 * (a linked account demoted to viewer included; cast_award_vote refuses it).
 */
export type BallotAccess = "vote" | "link" | "none";

export function ballotAccess(me: Me): BallotAccess {
  if (me.role !== "user" && me.role !== "admin") return "none";
  return me.myPlayerId ? "vote" : "link";
}

/** The caller's picks for one season, by award. */
export function picksForSeason(
  votes: AwardVote[],
  seasonId: string,
): Partial<Record<AwardId, string>> {
  const picks: Partial<Record<AwardId, string>> = {};
  for (const v of votes) {
    if (v.season_id === seasonId) picks[v.award_id] = v.nominee_player_id;
  }
  return picks;
}

/** A planned end must come after the season's start (seasons CHECK). */
export type PlannedEnd = ParsedMoment | { kind: "before_start" };

export function parsePlannedEnd(text: string, startedAtMs: number): PlannedEnd {
  const parsed = parseSwissDateTime(text);
  if (parsed.kind === "ok" && Date.parse(parsed.iso) <= startedAtMs) {
    return { kind: "before_start" };
  }
  return parsed;
}

/** The codes cast_award_vote and open_award_voting raise. */
export const AWARD_ERROR_CODES = [
  "not_allowed",
  "voter_not_linked",
  "unknown_award",
  "voting_not_open",
  "self_vote",
  "nominee_not_eligible",
  "season_not_active",
] as const;

/** Translation key for a voting RPC error, or null for anything unexpected. */
export function awardErrorKey(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return null;
  }
  const message = (error as { message: unknown }).message;
  return (AWARD_ERROR_CODES as readonly unknown[]).includes(message)
    ? `seasonAwards.errors.${message}`
    : null;
}
```

In `frontend/src/lib/supabase.ts`, add to `export type Season` after `ended_at`:

```ts
  /**
   * When the admin means to end it; award voting opens AWARD_VOTING_LEAD_DAYS
   * before (lib/seasonAwards.ts). Optional only so fixtures written before #121
   * still type-check - `select("*")` always returns it once migrated.
   */
  planned_end_at?: string | null;
  /** Set by "Open voting now" (open_award_voting), in server time. */
  voting_opened_at?: string | null;
```

Strings: add a top-level `seasonAwards` block after `seasonStats` in `frontend/src/locales/en.json` (later tasks extend it):

```json
  "seasonAwards": {
    "awards": {
      "award_offense": "Best Offensive Player",
      "award_defense": "Best Defender - The Wall",
      "award_fun": "Most Fun to Play With",
      "award_community": "Community Award",
      "award_improved": "Most Improved",
      "award_rookie": "Rookie of the Season",
      "award_guest": "Special Guest"
    },
    "errors": {
      "not_allowed": "You're not allowed to do that.",
      "voter_not_linked": "Link your account to your player to vote.",
      "unknown_award": "That award doesn't exist.",
      "voting_not_open": "Voting isn't open for this season.",
      "self_vote": "You can't vote for yourself.",
      "nominee_not_eligible": "That player isn't eligible for this award.",
      "season_not_active": "Voting can only be opened early for the running season.",
      "unknown": "Something went wrong. Please try again."
    }
  },
```

and the same place in `de.json`:

```json
  "seasonAwards": {
    "awards": {
      "award_offense": "Bester Stürmer",
      "award_defense": "Bester Verteidiger - Die Wand",
      "award_fun": "Grösster Spassfaktor",
      "award_community": "Community-Preis",
      "award_improved": "Grösster Fortschritt",
      "award_rookie": "Rookie der Saison",
      "award_guest": "Stargast"
    },
    "errors": {
      "not_allowed": "Das darfst du nicht.",
      "voter_not_linked": "Verknüpfe dein Konto mit deinem Spieler, um abzustimmen.",
      "unknown_award": "Diesen Award gibt es nicht.",
      "voting_not_open": "Für diese Saison läuft keine Abstimmung.",
      "self_vote": "Du kannst nicht für dich selbst stimmen.",
      "nominee_not_eligible": "Dieser Spieler kommt für diesen Award nicht in Frage.",
      "season_not_active": "Vorzeitig öffnen lässt sich die Abstimmung nur für die laufende Saison.",
      "unknown": "Etwas ist schiefgelaufen. Bitte versuch es nochmals."
    }
  },
```

- [ ] **Step 4: Run to see it pass**

Run: `cd frontend && pnpm exec vitest run src/lib/seasonAwards.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/seasonAwards.ts frontend/src/lib/seasonAwards.test.ts frontend/src/lib/supabase.ts frontend/src/locales/en.json frontend/src/locales/de.json
git commit -m "ELO-121: Voting window, eligibility and award list"
```

---

### Task 3: `AwardVoteNudge` + slots in Timeline and Season Stats

**Files:**
- Create: `frontend/src/components/AwardVoteNudge.tsx`
- Create: `frontend/src/components/AwardVoteNudge.test.tsx`
- Modify: `frontend/src/components/Timeline.tsx`, `frontend/src/components/SeasonStats.tsx`
- Modify: `frontend/src/App.css`, `frontend/src/locales/{en,de}.json`

**Interfaces:**
- Consumes: from Task 2, `seasonsOpenForVoting`, `awardVotingWindow`, `nextSeasonOf`, `ballotAccess`, `SEASON_AWARDS`, `AWARD_VOTING_TAIL_DAYS` and `AwardVote`; `useMe()` from `contexts/AuthContext`
- Produces:
  - `AwardVoteNudge({ seasons: Season[]; votes: AwardVote[]; onOpenBallot: (seasonId: string) => void; now?: number })`
  - `Timeline` and `SeasonStats` each gain an optional `awardNudge?: ReactNode` prop

- [ ] **Step 1: Write the failing test**

`frontend/src/components/AwardVoteNudge.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AwardVoteNudge } from "./AwardVoteNudge";
import type { Season } from "../lib/supabase";
import type { AwardId, AwardVote } from "../lib/seasonAwards";

const me = vi.hoisted(() => ({
  role: null as string | null,
  myPlayerId: null as string | null,
  refreshMyPlayer: async () => {},
}));
vi.mock("../contexts/AuthContext", () => ({ useMe: () => me }));
afterEach(() => {
  me.role = null;
  me.myPlayerId = null;
});

const DAY = 86_400_000;
const T0 = Date.parse("2026-10-01T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const season = (over: Partial<Season>): Season => ({
  id: "s5",
  number: 5,
  name: "Autumn",
  k_factor: 48,
  partner_weight: 0.25,
  inactivity_penalty_percent: 0,
  started_at: iso(T0 - 60 * DAY),
  ended_at: null,
  is_active: true,
  created_at: iso(T0 - 60 * DAY),
  planned_end_at: null,
  voting_opened_at: null,
  ...over,
});
// S4 ended at T0, when S5 started: S4's ballot is open until T0 + 14 days.
const S4 = season({ id: "s4", number: 4, name: "Summer", is_active: false, ended_at: iso(T0) });
const S5 = season({ started_at: iso(T0) });
const vote = (award_id: AwardId): AwardVote => ({
  season_id: "s4",
  award_id,
  voter_user_id: "u1",
  nominee_player_id: "p2",
  updated_at: iso(T0),
});

function renderNudge(over: Partial<React.ComponentProps<typeof AwardVoteNudge>> = {}) {
  const onOpenBallot = vi.fn();
  const view = render(
    <AwardVoteNudge
      seasons={[S5, S4]}
      votes={[vote("award_fun"), vote("award_guest")]}
      onOpenBallot={onOpenBallot}
      now={T0 + DAY}
      {...over}
    />,
  );
  return { onOpenBallot, ...view };
}

describe("AwardVoteNudge", () => {
  it("invites a linked player to vote, with progress and the deadline", async () => {
    me.role = "user";
    me.myPlayerId = "p1";
    const { onOpenBallot } = renderNudge();
    const nudge = screen.getByRole("button", { name: /Vote for the Season Awards/ });
    expect(nudge).toHaveTextContent("S4 · Summer");
    expect(nudge).toHaveTextContent("2/7 picked");
    expect(nudge).toHaveTextContent("closes 15.10.2026");
    await userEvent.click(nudge);
    expect(onOpenBallot).toHaveBeenCalledWith("s4");
  });

  it("can't name a closing date while the season is still running", () => {
    me.role = "admin";
    me.myPlayerId = "p1";
    renderNudge({ seasons: [season({ voting_opened_at: iso(T0) })], votes: [] });
    expect(screen.getByRole("button")).toHaveTextContent(
      "0/7 picked · closes 14 days into the next season",
    );
  });

  it("shows one nudge per open ballot", () => {
    me.role = "user";
    me.myPlayerId = "p1";
    renderNudge({ seasons: [{ ...S5, voting_opened_at: iso(T0) }, S4] });
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      expect.stringContaining("S4 · Summer"),
      expect.stringContaining("S5 · Autumn"),
    ]);
  });

  it("asks an unlinked user to link their player instead", () => {
    me.role = "user";
    renderNudge();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Link your player to vote/)).toBeInTheDocument();
  });

  it("shows nothing to viewers and visitors", () => {
    me.role = "viewer";
    me.myPlayerId = "p1";
    const { container } = renderNudge();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing when no ballot is open", () => {
    me.role = "user";
    me.myPlayerId = "p1";
    const { container } = renderNudge({ now: T0 + 14 * DAY });
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd frontend && pnpm exec vitest run src/components/AwardVoteNudge.test.tsx`
Expected: FAIL. `Failed to resolve import "./AwardVoteNudge"`.

- [ ] **Step 3: Implement**

`frontend/src/components/AwardVoteNudge.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Season } from "../lib/supabase";
import { useMe } from "../contexts/AuthContext";
import { DATE_LOCALE } from "../lib/i18n";
import {
  AWARD_VOTING_TAIL_DAYS,
  SEASON_AWARDS,
  awardVotingWindow,
  ballotAccess,
  nextSeasonOf,
  seasonsOpenForVoting,
  type AwardVote,
} from "../lib/seasonAwards";

// A window opening changes nothing in the DB, so no event would re-render us.
const TICK_MS = 60_000;

interface AwardVoteNudgeProps {
  seasons: Season[];
  /** The signed-in voter's own votes, every season. */
  votes: AwardVote[];
  onOpenBallot: (seasonId: string) => void;
  /** Fixed clock for tests; live (ticking) when omitted. */
  now?: number;
}

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString(DATE_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

/**
 * "🗳️ Vote for the Season Awards", one per season whose ballot is open. App
 * builds it once and slots it into Timeline and Season Stats. Only for roles
 * that can vote: an unlinked user/admin is told to link, everyone else sees
 * nothing.
 */
export function AwardVoteNudge({ seasons, votes, onOpenBallot, now }: AwardVoteNudgeProps) {
  const { t } = useTranslation();
  const me = useMe();
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (now !== undefined) return;
    const id = setInterval(() => setTick(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [now]);

  const access = ballotAccess(me);
  if (access === "none") return null;
  const open = seasonsOpenForVoting(seasons, now ?? tick);
  if (open.length === 0) return null;

  return (
    <div className="award-nudges">
      {open.map((season) => {
        const label = `S${season.number} · ${season.name}`;
        if (access === "link") {
          return (
            <div key={season.id} className="award-nudge award-nudge--muted">
              <span className="award-nudge-title">🗳️ {t("seasonAwards.nudge.title")}</span>
              <span className="award-nudge-meta">
                {label} · {t("seasonAwards.nudge.linkToVote")}
              </span>
            </div>
          );
        }
        const picked = votes.filter((v) => v.season_id === season.id).length;
        const { closesAt } = awardVotingWindow(season, nextSeasonOf(season, seasons));
        const closes =
          closesAt === null
            ? t("seasonAwards.nudge.closesAfterSeason", { days: AWARD_VOTING_TAIL_DAYS })
            : t("seasonAwards.nudge.closes", { date: formatDate(closesAt) });
        return (
          <button
            key={season.id}
            type="button"
            className="award-nudge"
            onClick={() => onOpenBallot(season.id)}
          >
            <span className="award-nudge-title">🗳️ {t("seasonAwards.nudge.title")}</span>
            <span className="award-nudge-meta">
              {label} ·{" "}
              {t("seasonAwards.nudge.picked", { picked, total: SEASON_AWARDS.length })} ·{" "}
              {closes}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

Slots:
- `Timeline.tsx`: `import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";` Add `/** Season Awards vote nudge (App builds it), shown under the title. */ awardNudge?: ReactNode;` to `DashboardProps`, destructure it, and render `{awardNudge}` directly after `<h2>{t("timeline.title")}</h2>` in **both** returns (the empty state and the main one).
- `SeasonStats.tsx`: `import { useMemo, useState, type ReactNode } from "react";` Add `/** Season Awards vote nudge; not tied to the scope select, so a just-ended season's ballot isn't hidden behind the default scope. */ awardNudge?: ReactNode;` to `SeasonStatsProps`, destructure it, and render `{awardNudge}` directly after the closing `</div>` of `.season-stats-head`.

`App.css`, after the `.season-stats-daterange` rule:

```css
/* ── Season Awards voting ─────────────────────────────────────── */
.award-nudges {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.award-nudge {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  width: 100%;
  padding: 0.65rem 0.85rem;
  border: 1px solid var(--color-border);
  border-left: 4px solid var(--color-primary);
  border-radius: 8px;
  background: var(--color-bg-light);
  color: var(--color-text);
  font: inherit;
  text-align: left;
}
button.award-nudge {
  cursor: pointer;
}
button.award-nudge:hover {
  border-color: var(--color-primary);
}
.award-nudge--muted {
  border-left-color: var(--color-border);
}
.award-nudge-title {
  font-weight: 700;
  font-size: 0.95rem;
}
.award-nudge-meta {
  font-size: 0.8rem;
  color: var(--color-text-light);
}
```

Strings, added inside `seasonAwards`. en:

```json
    "nudge": {
      "title": "Vote for the Season Awards",
      "picked": "{{picked}}/{{total}} picked",
      "closes": "closes {{date}}",
      "closesAfterSeason": "closes {{days}} days into the next season",
      "linkToVote": "Link your player to vote: open your player and choose “This is me”."
    },
```

de:

```json
    "nudge": {
      "title": "Stimm für die Saison-Awards ab",
      "picked": "{{picked}}/{{total}} gewählt",
      "closes": "endet am {{date}}",
      "closesAfterSeason": "endet {{days}} Tage nach dem Start der nächsten Saison",
      "linkToVote": "Verknüpfe deinen Spieler, um abzustimmen: Öffne deinen Spieler und wähle «Das bin ich»."
    },
```

- [ ] **Step 4: Run to see it pass, plus the whole suite**

Run: `cd frontend && pnpm exec vitest run src/components/AwardVoteNudge.test.tsx && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AwardVoteNudge.tsx frontend/src/components/AwardVoteNudge.test.tsx frontend/src/components/Timeline.tsx frontend/src/components/SeasonStats.tsx frontend/src/App.css frontend/src/locales/en.json frontend/src/locales/de.json
git commit -m "ELO-121: Vote nudge in Timeline and Season Stats"
```

---

### Task 4: `AwardBallotDialog`

**Files:**
- Create: `frontend/src/components/AwardBallotDialog.tsx`
- Create: `frontend/src/components/AwardBallotDialog.test.tsx`
- Modify: `frontend/src/App.css`, `frontend/src/locales/{en,de}.json`

**Interfaces:**
- Consumes: from Task 2, `SEASON_AWARDS`, `eligibleNomineeIds`, `picksForSeason`, `awardVotingWindow`, `nextSeasonOf`, `awardErrorKey`, `AwardId` and `AwardVote`; `RANKED_MIN_GAMES`; `PlayerAutocomplete`; `useMe()`
- Produces: `AwardBallotDialog({ season: Season; seasons: Season[]; players: Player[]; seasonStats: PlayerSeasonStats[]; votes: AwardVote[]; onCast: (awardId: AwardId, nomineeId: string | null) => Promise<void>; onClose: () => void })`

- [ ] **Step 1: Write the failing test**

`frontend/src/components/AwardBallotDialog.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AwardBallotDialog } from "./AwardBallotDialog";
import type { Player, PlayerSeasonStats, Season } from "../lib/supabase";
import type { AwardId, AwardVote } from "../lib/seasonAwards";

// You are Anna (p1).
const me = vi.hoisted(() => ({
  role: "user" as string | null,
  myPlayerId: "p1" as string | null,
  refreshMyPlayer: async () => {},
}));
vi.mock("../contexts/AuthContext", () => ({ useMe: () => me }));

const DAY = 86_400_000;
const T0 = Date.parse("2026-10-01T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const season = (id: string, number: number, over: Partial<Season> = {}): Season => ({
  id,
  number,
  name: `Season ${number}`,
  k_factor: 48,
  partner_weight: 0.25,
  inactivity_penalty_percent: 0,
  started_at: iso(T0 - 120 * DAY),
  ended_at: null,
  is_active: false,
  created_at: iso(T0 - 120 * DAY),
  planned_end_at: null,
  voting_opened_at: null,
  ...over,
});
const S4 = season("s4", 4, { ended_at: iso(T0 - 60 * DAY) });
const S5 = season("s5", 5, { started_at: iso(T0 - 60 * DAY), is_active: true, voting_opened_at: iso(T0) });
const player = (id: string, name: string): Player => ({
  id,
  name,
  current_elo: 1500,
  matches_played: 0,
  wins: 0,
  losses: 0,
  created_at: iso(T0),
  anonymous_name: null,
  is_linked: false,
});
const PLAYERS = [
  player("p1", "Anna"),
  player("p2", "Ben"),
  player("p3", "Carla"),
  player("p4", "Dario"),
  player("p5", "Emil"),
];
const stat = (player_id: string, season_id: string, games: number): PlayerSeasonStats => ({
  id: `${player_id}-${season_id}`,
  player_id,
  season_id,
  elo_at_start: 1500,
  current_season_elo: 1500,
  wins: games,
  losses: 0,
  last_match_at: null,
  created_at: iso(T0),
});
// Anna (you) and Ben are ranked for the first time, Dario for the second;
// Carla played once; Emil not at all.
const STATS = [
  stat("p1", "s5", 3),
  stat("p2", "s5", 3),
  stat("p3", "s5", 1),
  stat("p4", "s5", 4),
  stat("p4", "s4", 3),
];
const vote = (award_id: AwardId, nominee_player_id: string): AwardVote => ({
  season_id: "s5",
  award_id,
  voter_user_id: "u1",
  nominee_player_id,
  updated_at: iso(T0),
});

function setup(over: Partial<React.ComponentProps<typeof AwardBallotDialog>> = {}) {
  const onCast = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <AwardBallotDialog
      season={S5}
      seasons={[S5, S4]}
      players={PLAYERS}
      seasonStats={STATS}
      votes={[]}
      onCast={onCast}
      onClose={onClose}
      {...over}
    />,
  );
  return { onCast, onClose, user: userEvent.setup() };
}
const picker = (name: RegExp) => screen.getByRole("combobox", { name });
const optionNames = () =>
  screen
    .getAllByRole("option")
    .map((o) => o.querySelector(".player-ac-name")?.textContent ?? o.textContent);

describe("AwardBallotDialog", () => {
  it("has one picker per award", () => {
    setup();
    expect(screen.getAllByRole("combobox")).toHaveLength(7);
  });

  it("offers only eligible nominees, never yourself", async () => {
    const { user } = setup();
    await user.click(picker(/Best Offensive Player/));
    expect(optionNames()).toEqual(["No pick", "Ben", "Dario"]);
  });

  it("limits the rookie and guest awards to their nominees", async () => {
    const { user } = setup();
    await user.click(picker(/Rookie of the Season/));
    expect(optionNames()).toEqual(["No pick", "Ben"]);
    await user.keyboard("{Escape}");
    await user.click(picker(/Special Guest/));
    expect(optionNames()).toEqual(["No pick", "Carla"]);
  });

  it("saves a pick as soon as it's made", async () => {
    const { user, onCast } = setup();
    await user.click(picker(/Best Offensive Player/));
    await user.click(screen.getByRole("option", { name: /Ben/ }));
    expect(onCast).toHaveBeenCalledWith("award_offense", "p2");
    expect(screen.getByText("1/7 picked")).toBeInTheDocument();
  });

  it("clears a pick with No pick", async () => {
    const { user, onCast } = setup({ votes: [vote("award_offense", "p2")] });
    expect(picker(/Best Offensive Player/)).toHaveValue("Ben");
    await user.click(picker(/Best Offensive Player/));
    await user.click(screen.getByRole("option", { name: "No pick" }));
    expect(onCast).toHaveBeenCalledWith("award_offense", null);
  });

  it("puts a refused pick back and says why", async () => {
    const onCast = vi.fn().mockRejectedValue({ message: "voting_not_open" });
    const { user } = setup({ onCast });
    await user.click(picker(/Best Offensive Player/));
    await user.click(screen.getByRole("option", { name: /Ben/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Voting isn't open for this season."),
    );
    expect(picker(/Best Offensive Player/)).toHaveValue("");
  });

  it("keeps a pick who no longer qualifies visible, with a warning", () => {
    setup({ votes: [vote("award_guest", "p4")] });
    expect(picker(/Special Guest/)).toHaveValue("Dario");
    expect(
      screen.getByText(/Dario doesn't qualify for this award right now/),
    ).toBeInTheDocument();
  });

  it("disables an award nobody qualifies for yet", () => {
    setup({ seasonStats: STATS.filter((s) => s.player_id !== "p3") });
    expect(picker(/Special Guest/)).toBeDisabled();
    expect(picker(/Special Guest/)).toHaveAttribute("placeholder", "Nobody is eligible yet.");
  });

  it("closes on Done", async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd frontend && pnpm exec vitest run src/components/AwardBallotDialog.test.tsx`
Expected: FAIL. `Failed to resolve import "./AwardBallotDialog"`.

- [ ] **Step 3: Implement**

`frontend/src/components/AwardBallotDialog.tsx`:

```tsx
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Player, PlayerSeasonStats, Season } from "../lib/supabase";
import { useMe } from "../contexts/AuthContext";
import { DATE_LOCALE } from "../lib/i18n";
import { RANKED_MIN_GAMES } from "../lib/rosterFilter";
import { PlayerAutocomplete } from "./PlayerAutocomplete";
import {
  SEASON_AWARDS,
  awardErrorKey,
  awardVotingWindow,
  eligibleNomineeIds,
  nextSeasonOf,
  picksForSeason,
  type AwardId,
  type AwardVote,
} from "../lib/seasonAwards";

interface AwardBallotDialogProps {
  season: Season;
  seasons: Season[];
  players: Player[];
  /** Every season's standings - the rookie award looks at earlier seasons. */
  seasonStats: PlayerSeasonStats[];
  /** The voter's own votes (any season); read once, when the dialog opens. */
  votes: AwardVote[];
  /** Saves one pick; null clears it. A rejection reverts the pick and says why. */
  onCast: (awardId: AwardId, nomineeId: string | null) => Promise<void>;
  onClose: () => void;
}

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString(DATE_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

/**
 * The Season Awards ballot: one picker per award, limited to who qualifies
 * right now, your own player never offered. Each pick is saved as it's made
 * (cast_award_vote), so there's nothing to submit and any award can be
 * skipped. A pick who stopped qualifying stays visible with a warning -
 * blanking it would hide that the vote is at risk.
 *
 * Portalled to <body> above SeasonDialog (z-[1000]), which it can open from.
 */
export function AwardBallotDialog({
  season,
  seasons,
  players,
  seasonStats,
  votes,
  onCast,
  onClose,
}: AwardBallotDialogProps) {
  const { t } = useTranslation();
  const { myPlayerId } = useMe();
  const [picks, setPicks] = useState(() => picksForSeason(votes, season.id));
  const [saving, setSaving] = useState<Partial<Record<AwardId, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<AwardId, string>>>({});

  const eligible = useMemo(
    () =>
      new Map(
        SEASON_AWARDS.map((award) => [
          award.id,
          eligibleNomineeIds(award, season, seasons, seasonStats),
        ]),
      ),
    [season, seasons, seasonStats],
  );
  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const { closesAt } = awardVotingWindow(season, nextSeasonOf(season, seasons));
  const pickedCount = Object.values(picks).filter(Boolean).length;

  const pick = async (awardId: AwardId, playerId: string) => {
    const previous = picks[awardId] ?? "";
    if (playerId === previous) return;
    setPicks((p) => ({ ...p, [awardId]: playerId || undefined }));
    setErrors((e) => ({ ...e, [awardId]: undefined }));
    setSaving((s) => ({ ...s, [awardId]: true }));
    try {
      await onCast(awardId, playerId || null);
    } catch (err) {
      setPicks((p) => ({ ...p, [awardId]: previous || undefined }));
      setErrors((e) => ({
        ...e,
        [awardId]: t(awardErrorKey(err) ?? "seasonAwards.errors.unknown"),
      }));
    } finally {
      setSaving((s) => ({ ...s, [awardId]: false }));
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1100] p-4"
      onClick={onClose}
    >
      <div
        className="modal-panel bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="award-ballot-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="award-ballot-title" className="text-xl font-bold mb-3">
          🗳️ {t("seasonAwards.ballot.title", { season: `S${season.number} · ${season.name}` })}
        </h2>
        <p className="text-sm mb-2">
          {t("seasonAwards.ballot.intro")}
          {closesAt !== null && ` ${t("seasonAwards.ballot.closes", { date: formatDate(closesAt) })}`}
        </p>
        <p className="text-sm text-text-light mb-4">
          {t("seasonAwards.ballot.secret")} {t("seasonAwards.ballot.recheck")}
        </p>

        {SEASON_AWARDS.map((award) => {
          const ids = eligible.get(award.id) ?? new Set<string>();
          const current = picks[award.id] ?? "";
          const options = players.filter(
            (p) => p.id !== myPlayerId && (ids.has(p.id) || p.id === current),
          );
          const nobody = options.length === 0;
          return (
            <div key={award.id} className="award-ballot-row">
              <PlayerAutocomplete
                label={`${award.icon} ${t(`seasonAwards.awards.${award.id}`)}`}
                players={options}
                value={current}
                onChange={(id) => void pick(award.id, id)}
                emptyLabel={t("seasonAwards.ballot.noPick")}
                placeholder={
                  nobody
                    ? t("seasonAwards.ballot.nobodyEligible")
                    : t("seasonAwards.ballot.choose")
                }
                disabled={nobody || saving[award.id]}
              />
              <p className="award-ballot-hint">
                {t(`seasonAwards.nominees.${award.nominees}`, {
                  min: RANKED_MIN_GAMES,
                  max: RANKED_MIN_GAMES - 1,
                })}
                {saving[award.id] && ` · ${t("seasonAwards.ballot.saving")}`}
              </p>
              {current && !ids.has(current) && (
                <p className="award-ballot-warning">
                  {t("seasonAwards.ballot.noLongerEligible", {
                    name: playerById.get(current)?.name ?? "?",
                  })}
                </p>
              )}
              {errors[award.id] && (
                <p role="alert" className="award-ballot-error">
                  {errors[award.id]}
                </p>
              )}
            </div>
          );
        })}

        <div className="flex items-center justify-between gap-2 mt-4">
          <span className="text-sm text-text-light">
            {t("seasonAwards.nudge.picked", { picked: pickedCount, total: SEASON_AWARDS.length })}
          </span>
          <button className="btn-primary" onClick={onClose}>
            {t("seasonAwards.ballot.done")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

`App.css`, after the nudge rules:

```css
.award-ballot-row {
  margin-bottom: 0.9rem;
}
.award-ballot-row .form-group {
  margin-bottom: 0.2rem;
}
.award-ballot-hint {
  font-size: 0.75rem;
  color: var(--color-text-light);
}
.award-ballot-warning {
  font-size: 0.78rem;
  color: var(--color-warning);
  margin-top: 0.2rem;
}
.award-ballot-error {
  font-size: 0.78rem;
  color: var(--color-error);
  margin-top: 0.2rem;
}
```

Strings, added inside `seasonAwards`. en:

```json
    "nominees": {
      "ranked": "Ranked players ({{min}}+ games this season)",
      "rookie": "Ranked this season for the first time",
      "guest": "Played 1-{{max}} games this season"
    },
    "ballot": {
      "title": "Season Awards · {{season}}",
      "intro": "Pick one player per award, or skip any. Picks save as you go and can be changed until voting closes.",
      "closes": "Voting closes on {{date}}.",
      "secret": "Your ballot is secret: nobody else can see it, admins included.",
      "recheck": "Who qualifies is checked again when voting closes, and a vote for someone who no longer does is dropped.",
      "noPick": "No pick",
      "choose": "Choose a player…",
      "nobodyEligible": "Nobody is eligible yet.",
      "noLongerEligible": "{{name}} doesn't qualify for this award right now. Unless that changes before voting closes, this vote won't count.",
      "saving": "saving…",
      "done": "Done"
    },
```

de:

```json
    "nominees": {
      "ranked": "Gewertete Spieler (ab {{min}} Spielen diese Saison)",
      "rookie": "Diese Saison zum ersten Mal gewertet",
      "guest": "Diese Saison 1-{{max}} Spiele gespielt"
    },
    "ballot": {
      "title": "Saison-Awards · {{season}}",
      "intro": "Wähle pro Award einen Spieler oder lass einen aus. Deine Wahl wird sofort gespeichert und lässt sich bis zum Ende der Abstimmung ändern.",
      "closes": "Die Abstimmung endet am {{date}}.",
      "secret": "Deine Stimmen sind geheim: Niemand sonst sieht sie, auch keine Admins.",
      "recheck": "Wer in Frage kommt, wird am Ende der Abstimmung nochmals geprüft. Stimmen für Spieler, die dann nicht mehr in Frage kommen, verfallen.",
      "noPick": "Keine Wahl",
      "choose": "Spieler wählen…",
      "nobodyEligible": "Noch kommt niemand in Frage.",
      "noLongerEligible": "{{name}} kommt für diesen Award gerade nicht in Frage. Ändert sich das bis zum Ende der Abstimmung nicht, zählt diese Stimme nicht.",
      "saving": "wird gespeichert…",
      "done": "Fertig"
    },
```

- [ ] **Step 4: Run to see it pass**

Run: `cd frontend && pnpm exec vitest run src/components/AwardBallotDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AwardBallotDialog.tsx frontend/src/components/AwardBallotDialog.test.tsx frontend/src/App.css frontend/src/locales/en.json frontend/src/locales/de.json
git commit -m "ELO-121: Season Awards ballot dialog"
```

---

### Task 5: Vote data layer + App wiring

**Files:**
- Modify: `frontend/src/lib/supabase.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/SeasonDialog.tsx` (only the `awardNudge` pass-through here)

**Interfaces:**
- Consumes: `AwardVoteNudge` (Task 3), `AwardBallotDialog` (Task 4), `AwardId`/`AwardVote` (Task 2)
- Produces: `getMyAwardVotes(): Promise<AwardVote[]>`, `castAwardVote(seasonId: string, awardId: AwardId, nomineePlayerId: string | null): Promise<void>`, and `SeasonDialog`'s optional `awardNudge?: ReactNode` prop, which it passes to `SeasonStats`

- [ ] **Step 1: Data functions**

In `supabase.ts`, add `import type { AwardId, AwardVote } from "./seasonAwards";` beside the other imports. Then, after `endSeasonAndStartNew`:

```ts
// ---------------------------------------------------------------------------
// Season Awards voting
// ---------------------------------------------------------------------------

export type { AwardVote } from "./seasonAwards";

/**
 * The caller's own votes, every season. RLS returns nobody else's - admins
 * included - so this is a ballot, never a tally.
 */
export async function getMyAwardVotes(): Promise<AwardVote[]> {
  const { data, error } = await supabase
    .from("season_award_votes")
    .select("season_id, award_id, voter_user_id, nominee_player_id, updated_at");
  if (error) throw error;
  return (data ?? []) as AwardVote[];
}

/**
 * Sets one pick, or clears it with null. The RPC raises the bare codes in
 * seasonAwards.ts's AWARD_ERROR_CODES; awardErrorKey translates them.
 */
export async function castAwardVote(
  seasonId: string,
  awardId: AwardId,
  nomineePlayerId: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("cast_award_vote", {
    p_season_id: seasonId,
    p_award_id: awardId,
    p_nominee_player_id: nomineePlayerId,
  });
  if (error) throw error;
}
```

- [ ] **Step 2: App wiring**

In `App.tsx`:
- Add `castAwardVote`, `getMyAwardVotes` and `AwardVote` to the `./lib/supabase` import. Import `AwardVoteNudge` from `./components/AwardVoteNudge` and `AwardBallotDialog` from `./components/AwardBallotDialog`.
- Next to the other stable fallbacks: `const EMPTY_AWARD_VOTES: AwardVote[] = [];`
- After the `appData` `useQuery` (hooks must stay above the `AppSkeleton` early return):

```ts
  // The caller's own ballot. A query of its own rather than part of appData:
  // only the nudge and the ballot read it, and a pick shouldn't refetch the
  // dashboard. RLS returns nobody else's votes, admins included.
  const { data: awardVotes = EMPTY_AWARD_VOTES, isSuccess: awardVotesLoaded } =
    useQuery({
      queryKey: ["awardVotes", user?.id ?? null],
      queryFn: getMyAwardVotes,
      enabled: !authLoading && Boolean(user) && Boolean(myPlayerId),
    });
  const [ballotSeasonId, setBallotSeasonId] = useState<string | null>(null);
```

- After `const tabCls = ...` (plain values, so below the early return is fine):

```tsx
  const ballotSeason = ballotSeasonId
    ? (seasons.find((s) => s.id === ballotSeasonId) ?? null)
    : null;
  const awardNudge = (
    <AwardVoteNudge seasons={seasons} votes={awardVotes} onOpenBallot={setBallotSeasonId} />
  );
```

- Pass `awardNudge={awardNudge}` to `<Timeline>` and to `<SeasonDialog>`.
- Next to the `ChangelogDialog` render:

```tsx
      {/* Waits for the ballot to load, or it would open blank and read as "no picks". */}
      {ballotSeason && awardVotesLoaded && (
        <AwardBallotDialog
          season={ballotSeason}
          seasons={seasons}
          players={players}
          seasonStats={allPlayerSeasonStats}
          votes={awardVotes}
          onCast={async (awardId, nomineeId) => {
            await castAwardVote(ballotSeason.id, awardId, nomineeId);
            await queryClient.invalidateQueries({ queryKey: ["awardVotes"] });
          }}
          onClose={() => setBallotSeasonId(null)}
        />
      )}
```

In `SeasonDialog.tsx`: change the import to `import { useState, type ReactNode } from "react";`, add `/** Season Awards vote nudge, forwarded to Season Stats. */ awardNudge?: ReactNode;` to `SeasonDialogProps`, destructure it, and pass `awardNudge={awardNudge}` to `<SeasonStats>`.

- [ ] **Step 3: Verify**

Run: `cd frontend && pnpm lint && pnpm test && pnpm exec tsc --noEmit -p .`
Expected: lint and tests PASS. `tsc` reports only the 10 pre-existing errors, all in `src/components/Leaderboard.tsx` (the baseline on 2026-09-30).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/supabase.ts frontend/src/App.tsx frontend/src/components/SeasonDialog.tsx
git commit -m "ELO-121: Load the ballot and open it from the nudge"
```

---

### Task 6: Planned end + "Open voting now"

**Files:**
- Create: `frontend/src/components/SeasonScheduleAdmin.tsx`
- Create: `frontend/src/components/SeasonScheduleAdmin.test.tsx`
- Modify: `frontend/src/lib/supabase.ts`, `frontend/src/components/SeasonDialog.tsx`
- Modify: `frontend/src/App.css`, `frontend/src/locales/{en,de}.json`

**Interfaces:**
- Consumes: from Task 2, `parsePlannedEnd`, `awardVotingStatus`, `awardVotingWindow`, `awardErrorKey` and `AWARD_VOTING_LEAD_DAYS`; `maskSwissDateTime`, `toSwissDateTime` and `SWISS_DATETIME_FORMAT` from `lib/banners.ts`
- Produces:
  - `updateSeasonPlannedEnd(seasonId, plannedEndAt: string | null)`
  - `openAwardVoting(seasonId)`
  - `endSeasonAndStartNew(name, k, penalty, partnerWeight, plannedEndAt: string | null)`
  - `SeasonScheduleAdmin({ season; onSavePlannedEnd: (iso: string | null) => Promise<void>; onOpenVoting: () => Promise<void>; now?: number })`

- [ ] **Step 1: Write the failing test**

`frontend/src/components/SeasonScheduleAdmin.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SeasonScheduleAdmin } from "./SeasonScheduleAdmin";
import type { Season } from "../lib/supabase";

// Local time throughout, like the field.
const T0 = new Date(2026, 9, 1, 12, 0).getTime();
const season = (over: Partial<Season> = {}): Season => ({
  id: "s5",
  number: 5,
  name: "Autumn",
  k_factor: 48,
  partner_weight: 0.25,
  inactivity_penalty_percent: 0,
  started_at: new Date(2026, 7, 1).toISOString(),
  ended_at: null,
  is_active: true,
  created_at: new Date(2026, 7, 1).toISOString(),
  planned_end_at: null,
  voting_opened_at: null,
  ...over,
});

function setup(over: Partial<React.ComponentProps<typeof SeasonScheduleAdmin>> = {}) {
  const onSavePlannedEnd = vi.fn().mockResolvedValue(undefined);
  const onOpenVoting = vi.fn().mockResolvedValue(undefined);
  render(
    <SeasonScheduleAdmin
      season={season()}
      onSavePlannedEnd={onSavePlannedEnd}
      onOpenVoting={onOpenVoting}
      now={T0}
      {...over}
    />,
  );
  return {
    onSavePlannedEnd,
    onOpenVoting,
    user: userEvent.setup(),
    field: screen.getByLabelText("Planned end"),
    save: () => screen.getByRole("button", { name: "Save" }),
  };
}
afterEach(() => vi.restoreAllMocks());

describe("SeasonScheduleAdmin", () => {
  it("shows the planned end in Swiss format", () => {
    const { field } = setup({
      season: season({ planned_end_at: new Date(2026, 10, 30, 18, 0).toISOString() }),
    });
    expect(field).toHaveValue("30.11.2026 18:00");
  });

  it("saves a typed planned end", async () => {
    const { user, field, save, onSavePlannedEnd } = setup();
    await user.type(field, "301120261800");
    await user.click(save());
    expect(onSavePlannedEnd).toHaveBeenCalledWith(new Date(2026, 10, 30, 18, 0).toISOString());
  });

  it("saves an emptied field as no planned end", async () => {
    const { user, field, save, onSavePlannedEnd } = setup({
      season: season({ planned_end_at: new Date(2026, 10, 30).toISOString() }),
    });
    await user.clear(field);
    await user.click(save());
    expect(onSavePlannedEnd).toHaveBeenCalledWith(null);
  });

  it("refuses a date that doesn't exist or comes before the start", async () => {
    const { user, field, save, onSavePlannedEnd } = setup();
    await user.type(field, "31022027");
    await user.click(save());
    expect(screen.getByRole("alert")).toHaveTextContent("dd.mm.yyyy hh:mm");
    await user.clear(field);
    await user.type(field, "01072026");
    await user.click(save());
    expect(screen.getByRole("alert")).toHaveTextContent("after the season starts");
    expect(onSavePlannedEnd).not.toHaveBeenCalled();
  });

  it("opens voting after a confirm", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user, onOpenVoting } = setup();
    await user.click(screen.getByRole("button", { name: "Open voting now" }));
    expect(onOpenVoting).toHaveBeenCalledOnce();
  });

  it("does nothing when the confirm is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user, onOpenVoting } = setup();
    await user.click(screen.getByRole("button", { name: "Open voting now" }));
    expect(onOpenVoting).not.toHaveBeenCalled();
  });

  it("says so once voting is open", () => {
    setup({ season: season({ voting_opened_at: new Date(T0 - 1000).toISOString() }) });
    expect(screen.getByRole("button", { name: "Voting is open" })).toBeDisabled();
  });

  it("explains a refusal", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = setup({
      onOpenVoting: vi.fn().mockRejectedValue({ message: "season_not_active" }),
    });
    await user.click(screen.getByRole("button", { name: "Open voting now" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("running season"),
    );
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd frontend && pnpm exec vitest run src/components/SeasonScheduleAdmin.test.tsx`
Expected: FAIL. `Failed to resolve import "./SeasonScheduleAdmin"`.

- [ ] **Step 3: Implement**

`frontend/src/components/SeasonScheduleAdmin.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Season } from "../lib/supabase";
import { SWISS_DATETIME_FORMAT, maskSwissDateTime, toSwissDateTime } from "../lib/banners";
import {
  AWARD_VOTING_LEAD_DAYS,
  awardErrorKey,
  awardVotingStatus,
  parsePlannedEnd,
} from "../lib/seasonAwards";

interface SeasonScheduleAdminProps {
  /** The running season. */
  season: Season;
  /** null clears the planned end. */
  onSavePlannedEnd: (plannedEndAt: string | null) => Promise<void>;
  onOpenVoting: () => Promise<void>;
  now?: number;
}

/**
 * Admin-only, in SeasonDialog's info view: the running season's planned end
 * (award voting opens a lead week before it) and "Open voting now". Opening is
 * one-way - open_award_voting keeps the first moment - hence the confirm.
 */
export function SeasonScheduleAdmin({
  season,
  onSavePlannedEnd,
  onOpenVoting,
  now = Date.now(),
}: SeasonScheduleAdminProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => toSwissDateTime(season.planned_end_at ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The running season has no successor yet, so its voting can't have closed.
  const votingOpen = awardVotingStatus(season, null, now) === "open";

  const save = async () => {
    const parsed = parsePlannedEnd(text, Date.parse(season.started_at));
    if (parsed.kind === "invalid") {
      setError(t("seasonDialog.plannedEndInvalid", { format: SWISS_DATETIME_FORMAT }));
      return;
    }
    if (parsed.kind === "before_start") {
      setError(t("seasonDialog.plannedEndBeforeStart"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSavePlannedEnd(parsed.kind === "ok" ? parsed.iso : null);
    } catch {
      setError(t("seasonDialog.scheduleError"));
    } finally {
      setBusy(false);
    }
  };

  const openNow = async () => {
    if (!confirm(t("seasonDialog.openVotingConfirm"))) return;
    setBusy(true);
    setError(null);
    try {
      await onOpenVoting();
    } catch (err) {
      setError(t(awardErrorKey(err) ?? "seasonDialog.scheduleError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="season-schedule-admin">
      <div className="form-group">
        <label htmlFor="season-planned-end">{t("seasonDialog.plannedEnd")}</label>
        <div className="flex gap-2">
          <input
            id="season-planned-end"
            type="text"
            inputMode="numeric"
            value={text}
            placeholder={SWISS_DATETIME_FORMAT}
            onChange={(e) => setText(maskSwissDateTime(e.target.value))}
            disabled={busy}
          />
          <button className="btn-secondary" onClick={save} disabled={busy}>
            {t("seasonDialog.save")}
          </button>
        </div>
        <span className="block text-[0.78rem] text-text-light mt-1">
          {t("seasonDialog.plannedEndHint", {
            format: SWISS_DATETIME_FORMAT,
            days: AWARD_VOTING_LEAD_DAYS,
          })}
        </span>
      </div>
      <button className="btn-secondary" onClick={openNow} disabled={busy || votingOpen}>
        {votingOpen ? t("seasonDialog.votingIsOpen") : t("seasonDialog.openVoting")}
      </button>
      {error && (
        <p
          role="alert"
          className="bg-error-light text-error px-4 py-3 rounded-md text-sm border-l-4 border-error mt-3"
        >
          {error}
        </p>
      )}
    </section>
  );
}
```

`App.css`, after the ballot rules:

```css
.season-schedule-admin {
  border-top: 1px solid var(--color-border);
  padding-top: 1rem;
  margin-bottom: 1rem;
}
```

`supabase.ts`: give `endSeasonAndStartNew` a fifth parameter `newPlannedEndAt: string | null` and pass it as `new_planned_end_at: newPlannedEndAt` in the RPC args. Then add, after it:

```ts
/** Admin-only (RLS "Admins can update seasons"). null clears it. */
export async function updateSeasonPlannedEnd(
  seasonId: string,
  plannedEndAt: string | null,
): Promise<void> {
  markLocalMutation();
  const { error } = await supabase
    .from("seasons")
    .update({ planned_end_at: plannedEndAt })
    .eq("id", seasonId);
  if (error) throw error;
}

/** Admin-only: opens the running season's award voting now, in server time. */
export async function openAwardVoting(seasonId: string): Promise<void> {
  markLocalMutation();
  const { error } = await supabase.rpc("open_award_voting", { p_season_id: seasonId });
  if (error) throw error;
}
```

`SeasonDialog.tsx`:
- Imports: add `openAwardVoting` and `updateSeasonPlannedEnd` to the `../lib/supabase` import. Add `import { SWISS_DATETIME_FORMAT, maskSwissDateTime } from "../lib/banners";`, `import { AWARD_VOTING_LEAD_DAYS, awardVotingStatus, awardVotingWindow, parsePlannedEnd } from "../lib/seasonAwards";` and `import { SeasonScheduleAdmin } from "./SeasonScheduleAdmin";`.
- State: `const [newPlannedEnd, setNewPlannedEnd] = useState("");`. Reset it in `openDialog` (`setNewPlannedEnd("")`).
- In `handleConfirmNewSeason`, after the name check:

```ts
    const plannedEnd = parsePlannedEnd(newPlannedEnd, Date.now());
    if (plannedEnd.kind === "invalid") {
      setError(t("seasonDialog.plannedEndInvalid", { format: SWISS_DATETIME_FORMAT }));
      return;
    }
    if (plannedEnd.kind === "before_start") {
      setError(t("seasonDialog.plannedEndBeforeStart"));
      return;
    }
```

  and pass `plannedEnd.kind === "ok" ? plannedEnd.iso : null` as the fifth argument to `endSeasonAndStartNew`.
- Helper, beside `formatDate`:

```ts
  const votingText = (season: Season) => {
    if (awardVotingStatus(season, null, Date.now()) === "open") {
      return t("seasonDialog.votingOpen");
    }
    const { opensAt } = awardVotingWindow(season, null);
    return opensAt === null
      ? t("seasonDialog.votingOpensAtEnd")
      : t("seasonDialog.votingOpens", { date: formatDate(new Date(opensAt).toISOString()) });
  };
```

- Info `<dl>`, after the "Started" pair, with the same `dt` classes:

```tsx
                  <dt className="font-semibold text-text-light whitespace-nowrap">
                    {t("seasonDialog.plannedEnd")}
                  </dt>
                  <dd className="m-0">
                    {activeSeason?.planned_end_at
                      ? formatDate(activeSeason.planned_end_at)
                      : t("seasonDialog.notPlanned")}
                  </dd>

                  <dt className="font-semibold text-text-light whitespace-nowrap">
                    {t("seasonDialog.awardVoting")}
                  </dt>
                  <dd className="m-0">{activeSeason ? votingText(activeSeason) : "-"}</dd>
```

- Directly after the `</dl>`:

```tsx
                {isAdmin && activeSeason && (
                  <SeasonScheduleAdmin
                    key={activeSeason.id}
                    season={activeSeason}
                    onSavePlannedEnd={async (iso) => {
                      await updateSeasonPlannedEnd(activeSeason.id, iso);
                      onSeasonChanged();
                    }}
                    onOpenVoting={async () => {
                      await openAwardVoting(activeSeason.id);
                      onSeasonChanged();
                    }}
                  />
                )}
```

- In the new-season view, after the penalty `form-group`:

```tsx
                <div className="form-group">
                  <label htmlFor="season-planned-end-new">
                    {t("seasonDialog.plannedEndOptional")}
                  </label>
                  <input
                    id="season-planned-end-new"
                    type="text"
                    inputMode="numeric"
                    value={newPlannedEnd}
                    placeholder={SWISS_DATETIME_FORMAT}
                    onChange={(e) => setNewPlannedEnd(maskSwissDateTime(e.target.value))}
                    disabled={loading}
                  />
                  <span className="block text-[0.78rem] text-text-light mt-1">
                    {t("seasonDialog.plannedEndHint", {
                      format: SWISS_DATETIME_FORMAT,
                      days: AWARD_VOTING_LEAD_DAYS,
                    })}
                  </span>
                </div>
```

Strings, added inside `seasonDialog`. en:

```json
    "plannedEnd": "Planned end",
    "plannedEndOptional": "Planned end (optional)",
    "notPlanned": "Not set",
    "plannedEndHint": "Format {{format}}. Season Awards voting opens {{days}} days before this date; left empty, it opens when the season ends.",
    "plannedEndInvalid": "Enter the planned end as {{format}}.",
    "plannedEndBeforeStart": "The planned end has to be after the season starts.",
    "awardVoting": "Award voting",
    "votingOpen": "Open",
    "votingOpens": "Opens {{date}}",
    "votingOpensAtEnd": "Opens when the season ends",
    "save": "Save",
    "openVoting": "Open voting now",
    "openVotingConfirm": "Open Season Awards voting now? This can't be undone.",
    "votingIsOpen": "Voting is open",
    "scheduleError": "Couldn't save. Please try again."
```

de:

```json
    "plannedEnd": "Geplantes Ende",
    "plannedEndOptional": "Geplantes Ende (optional)",
    "notPlanned": "Nicht festgelegt",
    "plannedEndHint": "Format {{format}}. Die Abstimmung für die Saison-Awards beginnt {{days}} Tage vor diesem Datum; leer gelassen beginnt sie mit dem Saisonende.",
    "plannedEndInvalid": "Gib das geplante Ende im Format {{format}} ein.",
    "plannedEndBeforeStart": "Das geplante Ende muss nach dem Saisonstart liegen.",
    "awardVoting": "Award-Abstimmung",
    "votingOpen": "Läuft",
    "votingOpens": "Beginnt am {{date}}",
    "votingOpensAtEnd": "Beginnt mit dem Saisonende",
    "save": "Speichern",
    "openVoting": "Abstimmung jetzt öffnen",
    "openVotingConfirm": "Die Abstimmung für die Saison-Awards jetzt öffnen? Das lässt sich nicht rückgängig machen.",
    "votingIsOpen": "Abstimmung läuft",
    "scheduleError": "Speichern fehlgeschlagen. Bitte versuch es nochmals."
```

- [ ] **Step 4: Run to see it pass, plus everything**

Run: `cd frontend && pnpm exec vitest run src/components/SeasonScheduleAdmin.test.tsx && pnpm lint && pnpm test && pnpm exec tsc --noEmit -p .`
Expected: PASS. `tsc` reports only the 10 `Leaderboard.tsx` baseline errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SeasonScheduleAdmin.tsx frontend/src/components/SeasonScheduleAdmin.test.tsx frontend/src/lib/supabase.ts frontend/src/components/SeasonDialog.tsx frontend/src/App.css frontend/src/locales/en.json frontend/src/locales/de.json
git commit -m "ELO-121: Planned season end and Open voting now"
```

---

### Task 7: Visual check (staging)

Staging has the migration from Task 1. Run `pnpm dev` from `frontend/` (`.env.local` points at staging) or use the `run` skill. The user signs in: an admin account linked to a player, plus a second user account if one is at hand.

- [ ] **Step 1:** Season chip → info view shows "Planned end: Not set" and "Award voting: Opens when the season ends". As admin, set a planned end within 7 days and save. The row flips to "Open", and Timeline and Season Stats show the nudge.
- [ ] **Step 2:** Open the ballot from the Season Stats nudge (it must sit above the season dialog). Pick, change and clear a few awards, and check that the nudge's `x/7` follows. Your own player must never appear. Also check a picker near the bottom of the ballot, whose dropdown must stay reachable inside the scrolling panel.
- [ ] **Step 3:** Repeat in dark and Win95 (the ballot's title bar comes from `modal-panel`) and at phone width.
- [ ] **Step 4:** Clean up staging afterwards: clear the planned end in the UI. Only if the user agrees: `UPDATE seasons SET voting_opened_at = NULL WHERE is_active;` and `DELETE FROM season_award_votes;` as the owner.

---

### Task 8: Docs, changeset, verification, PR

**Files:**
- Modify: `CLAUDE.md`
- Create: `.changeset/season-award-voting.md`

- [ ] **Step 1: CLAUDE.md**
  - Frontend Structure: a `frontend/src/lib/seasonAwards.ts` bullet covering the awards, the window (earliest of opened / planned − 7d / ended, until next start + 14d, half-open, mirrored in `award_voting_is_open` in hours), eligibility from `player_season_stats` (mirrors `award_nominee_eligible`), `ballotAccess`, and the note that status is a pure function of time (60s tick in the nudge). Also bullets for `AwardVoteNudge` (a ReactNode slot App passes into Timeline and SeasonDialog → SeasonStats; ignores the scope select), `AwardBallotDialog` (saves per pick, portalled at `z-[1100]`, keeps stale picks visible) and `SeasonScheduleAdmin`.
  - Data Flow: votes come from their own query `["awardVotes", userId]`, not `fetchAppData`.
  - Tab visibility: the nudge is for `user`/`admin`; unlinked accounts get the link hint; viewers and visitors see nothing.
  - Database Schema: `seasons.planned_end_at` (CHECK after `started_at`) and `voting_opened_at`; `season_award_votes` (PK `(season_id, award_id, voter_user_id)`, own-row SELECT only, admins included, no write grants, written only by `cast_award_vote`); `open_award_voting`; the internal helpers #122 reuses.
  - Auth & Roles: `end_season_and_start_new` was callable by anon (`get_my_role() <> 'admin'` is NULL for them) and is fixed in `20260930_season_award_voting.sql`. `set_banner_order` and `apply_inactivity_penalties` share the problem unless the hotfix has landed; note whichever is true at merge time.
- [ ] **Step 2: Changeset** `.changeset/season-award-voting.md`:

```md
---
"toegg-elo-frontend": minor
---

Season Awards voting: linked players vote for seven awards, from a week before a season ends until two weeks into the next - secret ballot, changeable until it closes.

Adds `seasons.planned_end_at`/`voting_opened_at`, the `season_award_votes` table and the `cast_award_vote`/`open_award_voting` RPCs, and closes anon access to `end_season_and_start_new`. Apply `20260930_season_award_voting.sql` before deploying the frontend.
```

- [ ] **Step 3: Full verification**

Run: `cd frontend && pnpm lint && pnpm test && pnpm exec tsc --noEmit -p .`, then re-run `supabase/scripts/season-award-voting-checks.sql` on staging.
Expected: all PASS, only the 10 `Leaderboard.tsx` baseline `tsc` errors, and `season award voting: all checks passed`.

- [ ] **Step 4: Commit + PR**

```bash
git add CLAUDE.md .changeset/season-award-voting.md
git commit -m "ELO-121: Document season award voting"
git push -u origin elo-121-season-award-voting
```

Open the PR "ELO-121: Season Awards voting" with "Closes #121". The body covers the summary, the release order (migration → frontend) and the unchecked prod steps: apply the migration, run the checks script, confirm `anon_exec = false`. **Prod steps wait for the user's approval.** End the body with the harness's PR attribution line. Update the project memory (`elo121-season-award-voting.md` + the MEMORY.md line) with the status.
