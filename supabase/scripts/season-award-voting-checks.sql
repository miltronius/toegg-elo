-- Rule checks for Season Awards voting (#121). Runs inside a transaction that
-- is always rolled back: fixtures, season edits and votes all disappear.
-- Usage (repo root, linked to staging):
--   supabase db query --linked -f supabase/scripts/season-award-voting-checks.sql
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
-- 3 = one game (not ranked); 4 = ranked now and in an earlier season;
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
SELECT pg_temp.expect('one game is not ranked', $q$SELECT pg_temp.vote('award_offense', pg_temp.p(3))$q$, 'nominee_not_eligible');
SELECT pg_temp.expect('no games, no nomination', $q$SELECT pg_temp.vote('award_offense', pg_temp.p(6))$q$, 'nominee_not_eligible');
SELECT pg_temp.expect('the withdrawn guest award is unknown', $q$SELECT pg_temp.vote('award_guest', pg_temp.p(3))$q$, 'unknown_award');
SELECT pg_temp.expect('rookie award takes a first-time ranked player', $q$SELECT pg_temp.vote('award_rookie', pg_temp.p(2))$q$, NULL);
SELECT pg_temp.expect('rookie award refuses a veteran', $q$SELECT pg_temp.vote('award_rookie', pg_temp.p(4))$q$, 'nominee_not_eligible');
SELECT pg_temp.expect('unknown award', $q$SELECT pg_temp.vote('award_bogus', pg_temp.p(2))$q$, 'unknown_award');
SELECT pg_temp.expect('unknown season', $q$SELECT cast_award_vote(gen_random_uuid(), 'award_offense', pg_temp.p(2))$q$, 'voting_not_open');
SELECT pg_temp.expect('change a pick', $q$SELECT pg_temp.vote('award_offense', pg_temp.p(4))$q$, NULL);
SELECT pg_temp.expect_count('a change replaces the pick', $q$SELECT count(*) FROM season_award_votes WHERE award_id = 'award_offense' AND nominee_player_id = pg_temp.p(4)$q$, 1);
SELECT pg_temp.expect_count('one row per award', $q$SELECT count(*) FROM season_award_votes WHERE award_id = 'award_offense'$q$, 1);
SELECT pg_temp.expect('clear a pick', $q$SELECT pg_temp.vote('award_offense', NULL)$q$, NULL);
SELECT pg_temp.expect_count('voter reads own ballot', 'SELECT count(*) FROM season_award_votes', 1);
SELECT pg_temp.expect('no direct insert', $q$INSERT INTO season_award_votes (season_id, award_id, voter_user_id, nominee_player_id) VALUES (pg_temp.active(), 'award_fun', pg_temp.u(1), pg_temp.p(2))$q$, 'permission denied for table season_award_votes');
SELECT pg_temp.expect('no direct delete', $q$DELETE FROM season_award_votes WHERE true$q$, 'permission denied for table season_award_votes');

-- ── Secret ballot ────────────────────────────────────────────
SELECT pg_temp.act_as(pg_temp.u(2));
SELECT pg_temp.expect('admin votes too', $q$SELECT pg_temp.vote('award_offense', pg_temp.p(2))$q$, NULL);
SELECT pg_temp.expect_count('admin reads only their own votes', 'SELECT count(*) FROM season_award_votes', 1);
SELECT pg_temp.act_as(pg_temp.u(4));
SELECT pg_temp.expect_count('others read nothing', 'SELECT count(*) FROM season_award_votes', 0);

-- ── Turnout: counts only, for voters' roles only ─────────────
-- Staging may hold real votes in the running season, so compare against what
-- the owner counts directly rather than against fixed numbers.
SELECT pg_temp.act_as(pg_temp.u(3));
SELECT pg_temp.expect('viewer gets no turnout', $q$SELECT award_turnout(pg_temp.active())$q$, 'not_allowed');
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT set_config('vote_check.turnout', award_turnout(pg_temp.active())::text, true);
RESET ROLE;
SELECT pg_temp.expect_count('turnout counts voters',
  $q$SELECT (current_setting('vote_check.turnout')::jsonb->>'voters')::bigint$q$,
  (SELECT count(DISTINCT voter_user_id) FROM season_award_votes WHERE season_id = pg_temp.active()));
SELECT pg_temp.expect_count('turnout counts votes per award',
  $q$SELECT (current_setting('vote_check.turnout')::jsonb->'awards'->>'award_rookie')::bigint$q$,
  (SELECT count(*) FROM season_award_votes WHERE season_id = pg_temp.active() AND award_id = 'award_rookie'));
SELECT pg_temp.expect_count('turnout counts linked voters as eligible',
  $q$SELECT (current_setting('vote_check.turnout')::jsonb->>'eligible')::bigint$q$,
  (SELECT count(*) FROM player_accounts pa JOIN profiles pr ON pr.id = pa.user_id WHERE pr.role IN ('user', 'admin')));
SELECT pg_temp.expect_count('turnout names nobody',
  $q$SELECT count(*) FROM jsonb_object_keys(current_setting('vote_check.turnout')::jsonb)$q$, 3);
SET LOCAL ROLE anon;
SELECT pg_temp.act_as(NULL);
SELECT pg_temp.expect('anon gets no turnout', $q$SELECT award_turnout(pg_temp.active())$q$, 'permission denied for function award_turnout');
RESET ROLE;
SET LOCAL ROLE authenticated;

-- ── Window edges (user 1 re-picks the rookie, who stays eligible) ──
RESET ROLE;
SELECT pg_temp.shape(NULL, now() + interval '168 hours', NULL, NULL);
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('opens exactly 7 days before the planned end', $q$SELECT pg_temp.vote('award_rookie', pg_temp.p(2))$q$, NULL);

RESET ROLE;
SELECT pg_temp.shape(NULL, now() + interval '168 hours 1 second', NULL, NULL);
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('not a second earlier', $q$SELECT pg_temp.vote('award_rookie', pg_temp.p(2))$q$, 'voting_not_open');

RESET ROLE;
SELECT pg_temp.shape(NULL, NULL, NULL, NULL);
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('nothing set, nothing open', $q$SELECT pg_temp.vote('award_rookie', pg_temp.p(2))$q$, 'voting_not_open');

RESET ROLE;
SELECT pg_temp.shape(now(), NULL, NULL, NULL);
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('opened this instant counts', $q$SELECT pg_temp.vote('award_rookie', pg_temp.p(2))$q$, NULL);

RESET ROLE;
SELECT pg_temp.shape(NULL, NULL, now() - interval '1 hour', now() - interval '1 hour');
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('the end opens it without a plan', $q$SELECT pg_temp.vote('award_rookie', pg_temp.p(2))$q$, NULL);

RESET ROLE;
SELECT pg_temp.shape(NULL, NULL, now() - interval '20 days', now() - interval '336 hours' + interval '1 second');
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('open until 14 days into the next season', $q$SELECT pg_temp.vote('award_rookie', pg_temp.p(2))$q$, NULL);

RESET ROLE;
SELECT pg_temp.shape(NULL, NULL, now() - interval '20 days', now() - interval '336 hours');
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('closed at exactly 14 days', $q$SELECT pg_temp.vote('award_rookie', pg_temp.p(2))$q$, 'voting_not_open');
SELECT pg_temp.expect('a closed ballot cannot be cleared either', $q$SELECT pg_temp.vote('award_rookie', NULL)$q$, 'voting_not_open');

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
