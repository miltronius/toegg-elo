-- Rule checks for Season Awards results (#122). Runs inside a transaction that
-- is always rolled back: fixtures, votes, results and banners all disappear.
-- Usage (repo root, linked to staging):
--   supabase db query --linked -f supabase/scripts/season-award-results-checks.sql
-- Needs 20260930_season_award_voting.sql and 20261002_season_award_results.sql.
BEGIN;

-- Fixture ids: u(n) = account, p(n) = player.
CREATE FUNCTION pg_temp.u(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000e00' || n)::uuid $$;
CREATE FUNCTION pg_temp.p(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000f00' || n)::uuid $$;
CREATE FUNCTION pg_temp.active() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT id FROM seasons WHERE is_active $$;

-- Accounts 1-5 vote, each linked to the player with the same number; 1 is an
-- admin, 2-5 are users. 6 is a user without a player.
INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'result-check-' || n || '@test.invalid' FROM generate_series(1, 6) n;
UPDATE profiles SET role = 'user'  WHERE id IN (SELECT pg_temp.u(n) FROM generate_series(2, 6) n);
UPDATE profiles SET role = 'admin' WHERE id = pg_temp.u(1);

-- Players 1-5 are the voters; 6, 7 and 8 are ranked nominees, 8 a rookie.
INSERT INTO players (id, name)
SELECT pg_temp.p(n), 'Result Check ' || n FROM generate_series(1, 8) n;
INSERT INTO player_accounts (player_id, user_id)
SELECT pg_temp.p(n), pg_temp.u(n) FROM generate_series(1, 5) n;
UPDATE player_season_stats SET wins = 3
 WHERE season_id = pg_temp.active()
   AND player_id IN (pg_temp.p(6), pg_temp.p(7), pg_temp.p(8));

-- The running season, with nothing scheduled: voting not open yet.
UPDATE seasons SET voting_opened_at = NULL, planned_end_at = NULL, voting_closes_at = NULL,
                   awards_finalized_at = NULL
 WHERE is_active;
-- Real staging votes in the running season would skew the counts below.
DELETE FROM season_award_votes WHERE season_id = pg_temp.active();

CREATE FUNCTION pg_temp.act_as(uid UUID) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    CASE WHEN uid IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', uid, 'role', 'authenticated')::text END,
    true);
$$;

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

-- vote(voter, award, nominee) in the running season.
CREATE FUNCTION pg_temp.vote(voter INT, award TEXT, nominee INT) RETURNS void
LANGUAGE sql AS $$
  SELECT pg_temp.act_as(pg_temp.u(voter));
  SELECT cast_award_vote(pg_temp.active(), award, pg_temp.p(nominee));
$$;

CREATE FUNCTION pg_temp.result(award TEXT, nominee INT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT votes || CASE WHEN is_winner THEN ' winner' ELSE '' END
    FROM season_award_results
   WHERE season_id = pg_temp.active() AND award_id = award AND player_id = pg_temp.p(nominee)
$$;

-- ── Who may count, and when ──────────────────────────────────
SET LOCAL ROLE anon;
SELECT pg_temp.act_as(NULL);
SELECT pg_temp.expect('anon cannot count', $q$SELECT finalize_season_awards(pg_temp.active())$q$, 'permission denied for function finalize_season_awards');
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(2));
SELECT pg_temp.expect('a user cannot count', $q$SELECT finalize_season_awards(pg_temp.active())$q$, 'not_allowed');
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('nothing to count before voting opens', $q$SELECT finalize_season_awards(pg_temp.active())$q$, 'voting_not_open');
SELECT pg_temp.expect('an unknown season', $q$SELECT finalize_season_awards(gen_random_uuid())$q$, 'season_not_found');
SELECT pg_temp.expect('admin opens voting', $q$SELECT open_award_voting(pg_temp.active())$q$, NULL);

-- ── The ballots ──────────────────────────────────────────────
-- offense: 6 gets 2, 7 gets 1        -> 3 cast, 6 wins
-- defense: 6 gets 1, 7 gets 1        -> 2 cast, no winner
-- fun:     6 gets 2, 7 gets 2        -> tie, both win
-- rookie:  8 gets 3, but 8 turns out to have been ranked before -> dropped
SELECT pg_temp.vote(1, 'award_offense', 6);
SELECT pg_temp.vote(2, 'award_offense', 6);
SELECT pg_temp.vote(3, 'award_offense', 7);
SELECT pg_temp.vote(1, 'award_defense', 6);
SELECT pg_temp.vote(2, 'award_defense', 7);
SELECT pg_temp.vote(1, 'award_fun', 6);
SELECT pg_temp.vote(2, 'award_fun', 6);
SELECT pg_temp.vote(3, 'award_fun', 7);
SELECT pg_temp.vote(4, 'award_fun', 7);
SELECT pg_temp.vote(1, 'award_rookie', 8);
SELECT pg_temp.vote(2, 'award_rookie', 8);
SELECT pg_temp.vote(3, 'award_rookie', 8);

RESET ROLE;
INSERT INTO player_season_stats (player_id, season_id, elo_at_start, current_season_elo, wins, losses)
SELECT pg_temp.p(8), id, 1500, 1500, 3, 0
  FROM seasons WHERE NOT is_active ORDER BY number DESC LIMIT 1;

-- ── Close voting and count ───────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('admin closes voting and counts', $q$SELECT finalize_season_awards(pg_temp.active())$q$, NULL);

SELECT pg_temp.expect_count('closed at the count', 'SELECT count(*) FROM seasons WHERE is_active AND voting_closes_at = now()', 1);
SELECT pg_temp.expect_count('stamped final', 'SELECT count(*) FROM seasons WHERE is_active AND awards_finalized_at = now()', 1);
SELECT pg_temp.expect_count('offense: most votes wins', $q$SELECT count(*) WHERE pg_temp.result('award_offense', 6) = '2 winner' AND pg_temp.result('award_offense', 7) = '1'$q$, 1);
SELECT pg_temp.expect_count('defense: under 3 votes, no winner', $q$SELECT count(*) WHERE pg_temp.result('award_defense', 6) = '1' AND pg_temp.result('award_defense', 7) = '1'$q$, 1);
SELECT pg_temp.expect_count('fun: a tie shares the win', $q$SELECT count(*) WHERE pg_temp.result('award_fun', 6) = '2 winner' AND pg_temp.result('award_fun', 7) = '2 winner'$q$, 1);
SELECT pg_temp.expect_count('rookie: votes for an ineligible nominee are dropped', $q$SELECT count(*) FROM season_award_results WHERE season_id = pg_temp.active() AND award_id = 'award_rookie'$q$, 0);
SELECT pg_temp.expect_count('nothing else was written', $q$SELECT count(*) FROM season_award_results WHERE season_id = pg_temp.active()$q$, 6);

RESET ROLE;
SELECT pg_temp.expect_count('the ballots are gone', 'SELECT count(*) FROM season_award_votes WHERE season_id = pg_temp.active()', 0);
SELECT pg_temp.expect_count('winners get the award achievement', $q$SELECT count(*) FROM player_achievements WHERE season_id = pg_temp.active() AND (player_id, achievement_id) IN ((pg_temp.p(6), 'award_offense'), (pg_temp.p(6), 'award_fun'), (pg_temp.p(7), 'award_fun'))$q$, 3);
SELECT pg_temp.expect_count('...and only winners', $q$SELECT count(*) FROM player_achievements WHERE season_id = pg_temp.active() AND achievement_id LIKE 'award\_%'$q$, 3);
SELECT pg_temp.expect_count('one results banner, translated by default', $q$SELECT count(*) FROM banners WHERE award_season_id = pg_temp.active() AND message IS NULL AND is_active AND audience = 'everyone' AND ends_at = now() + interval '14 days'$q$, 1);

-- ── After the count ──────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('counting twice is a no-op', $q$SELECT finalize_season_awards(pg_temp.active())$q$, NULL);
SELECT pg_temp.expect_count('...and changes nothing', $q$SELECT count(*) FROM season_award_results WHERE season_id = pg_temp.active()$q$, 6);
RESET ROLE;
SELECT pg_temp.expect_count('...not even the banner', $q$SELECT count(*) FROM banners WHERE award_season_id = pg_temp.active()$q$, 1);
UPDATE seasons SET voting_closes_at = now() + interval '1 day' WHERE is_active;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(2));
SELECT pg_temp.expect('a later closing date does not reopen a counted season', $q$SELECT cast_award_vote(pg_temp.active(), 'award_offense', pg_temp.p(6))$q$, 'voting_not_open');
SELECT pg_temp.expect('nobody writes results directly', $q$INSERT INTO season_award_results (season_id, award_id, player_id, votes) VALUES (pg_temp.active(), 'award_fun', pg_temp.p(8), 9)$q$, 'permission denied for table season_award_results');
SELECT pg_temp.act_as(pg_temp.u(6));
SELECT pg_temp.expect_count('anyone signed in reads the results', $q$SELECT count(*) FROM season_award_results WHERE season_id = pg_temp.active()$q$, 6);
SET LOCAL ROLE anon;
SELECT pg_temp.act_as(NULL);
SELECT pg_temp.expect_count('so do logged-out visitors', $q$SELECT count(*) FROM season_award_results WHERE season_id = pg_temp.active()$q$, 6);

-- ── A results banner needs no text; others still do ──────────
RESET ROLE;
SELECT pg_temp.expect('a hand-written banner still needs text', $q$INSERT INTO banners (message) VALUES (NULL)$q$, 'new row for relation "banners" violates check constraint "banner_message_present"');

RESET ROLE;
SELECT 'season award results: all checks passed' AS result;
ROLLBACK;
