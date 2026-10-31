-- Rule checks for the Democracy! achievement (20261031_democracy_achievement.sql).
-- Runs inside a transaction that is always rolled back: fixtures, the opened
-- ballot and every vote disappear.
-- Usage (repo root, linked to staging):
--   supabase db query --linked -f supabase/scripts/democracy-achievement-checks.sql
BEGIN;

-- Fixture ids: u(n) = account, p(n) = player.
CREATE FUNCTION pg_temp.u(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000e00' || n)::uuid $$;
CREATE FUNCTION pg_temp.p(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000f00' || n)::uuid $$;
CREATE FUNCTION pg_temp.active() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT id FROM seasons WHERE is_active $$;

-- Accounts: 1 user (linked to player 1), 2 admin (linked to player 2),
-- 3 user without a player. Player 3 is a ranked nominee nobody owns.
INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'democracy-check-' || n || '@test.invalid' FROM generate_series(1, 3) n;
UPDATE profiles SET role = 'user'  WHERE id IN (pg_temp.u(1), pg_temp.u(3));
UPDATE profiles SET role = 'admin' WHERE id = pg_temp.u(2);
INSERT INTO players (id, name)
SELECT pg_temp.p(n), 'Democracy Check ' || n FROM generate_series(1, 3) n;
INSERT INTO player_accounts (player_id, user_id) VALUES
  (pg_temp.p(1), pg_temp.u(1)),
  (pg_temp.p(2), pg_temp.u(2));
UPDATE player_season_stats SET wins = 2, losses = 1
 WHERE season_id = pg_temp.active() AND player_id IN (pg_temp.p(1), pg_temp.p(2), pg_temp.p(3));
UPDATE seasons SET voting_opened_at = now() - interval '1 hour', voting_closes_at = NULL,
                   awards_finalized_at = NULL
 WHERE is_active;

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

CREATE FUNCTION pg_temp.vote(award TEXT, nominee UUID) RETURNS void LANGUAGE sql AS $$
  SELECT cast_award_vote(pg_temp.active(), award, nominee) $$;

-- How many voter rows / Democracy! rows a player has in the running season.
CREATE FUNCTION pg_temp.voters(player UUID) RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM season_award_voters
   WHERE season_id = pg_temp.active() AND player_id = player $$;
CREATE FUNCTION pg_temp.democracy(player UUID) RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM player_achievements
   WHERE achievement_id = 'democracy' AND season_id = pg_temp.active() AND player_id = player $$;

-- ── Never for whom ───────────────────────────────────────────
SELECT pg_temp.expect_count('voters table has no award or nominee column',
  $q$SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'season_award_voters'
        AND column_name NOT IN ('season_id', 'player_id', 'first_voted_at')$q$, 0);

-- ── Nobody writes it directly ────────────────────────────────
SET LOCAL ROLE anon;
SELECT pg_temp.act_as(NULL);
SELECT pg_temp.expect('anon reads voters', $q$SELECT count(*) FROM season_award_voters$q$, NULL);
SELECT pg_temp.expect('anon cannot insert voters', $q$INSERT INTO season_award_voters (season_id, player_id) VALUES (pg_temp.active(), pg_temp.p(1))$q$, 'permission denied for table season_award_voters');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('user cannot insert voters', $q$INSERT INTO season_award_voters (season_id, player_id) VALUES (pg_temp.active(), pg_temp.p(1))$q$, 'permission denied for table season_award_voters');
SELECT pg_temp.expect('user cannot delete voters', $q$DELETE FROM season_award_voters WHERE true$q$, 'permission denied for table season_award_voters');

-- ── A refused pick earns nothing ─────────────────────────────
SELECT pg_temp.expect('self-vote refused', $q$SELECT pg_temp.vote('award_fun', pg_temp.p(1))$q$, 'self_vote');
SELECT pg_temp.expect('clearing an empty ballot', $q$SELECT pg_temp.vote('award_fun', NULL)$q$, NULL);
SELECT pg_temp.act_as(pg_temp.u(3));
SELECT pg_temp.expect('unlinked user refused', $q$SELECT pg_temp.vote('award_fun', pg_temp.p(3))$q$, 'voter_not_linked');
RESET ROLE;
SELECT pg_temp.expect_count('no voter row from refusals or a clear', $q$SELECT pg_temp.voters(pg_temp.p(1))$q$, 0);
SELECT pg_temp.expect_count('no Democracy! from refusals or a clear', $q$SELECT pg_temp.democracy(pg_temp.p(1))$q$, 0);

-- ── The first pick earns it ──────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('first pick', $q$SELECT pg_temp.vote('award_fun', pg_temp.p(3))$q$, NULL);
RESET ROLE;
SELECT pg_temp.expect_count('first pick records the voter', $q$SELECT pg_temp.voters(pg_temp.p(1))$q$, 1);
SELECT pg_temp.expect_count('first pick earns Democracy!, dated like the voter row',
  $q$SELECT count(*) FROM player_achievements a JOIN season_award_voters v
       ON v.player_id = a.player_id AND v.season_id = a.season_id
      WHERE a.achievement_id = 'democracy' AND a.player_id = pg_temp.p(1)
        AND a.season_id = pg_temp.active() AND a.unlocked_at = v.first_voted_at$q$, 1);
SELECT pg_temp.expect_count('nobody else earns it', $q$SELECT pg_temp.democracy(pg_temp.p(3))$q$, 0);

-- now() is fixed in a transaction, so make the first pick an hour old to see
-- that later picks leave its date alone.
UPDATE season_award_voters SET first_voted_at = now() - interval '1 hour'
 WHERE season_id = pg_temp.active() AND player_id = pg_temp.p(1);

-- ── Later picks don't count ──────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('a second award', $q$SELECT pg_temp.vote('award_offense', pg_temp.p(3))$q$, NULL);
SELECT pg_temp.expect('a changed pick', $q$SELECT pg_temp.vote('award_fun', pg_temp.p(2))$q$, NULL);
RESET ROLE;
SELECT pg_temp.expect_count('still one voter row, first date kept',
  $q$SELECT count(*) FROM season_award_voters WHERE season_id = pg_temp.active()
      AND player_id = pg_temp.p(1) AND first_voted_at = now() - interval '1 hour'$q$, 1);
SELECT pg_temp.expect_count('still one Democracy!', $q$SELECT pg_temp.democracy(pg_temp.p(1))$q$, 1);

-- ── Clearing every pick keeps it ─────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(1));
SELECT pg_temp.expect('clear one', $q$SELECT pg_temp.vote('award_fun', NULL)$q$, NULL);
SELECT pg_temp.expect('clear the other', $q$SELECT pg_temp.vote('award_offense', NULL)$q$, NULL);
RESET ROLE;
SELECT pg_temp.expect_count('ballot empty', $q$SELECT count(*) FROM season_award_votes WHERE voter_user_id = pg_temp.u(1)$q$, 0);
SELECT pg_temp.expect_count('voter row kept', $q$SELECT pg_temp.voters(pg_temp.p(1))$q$, 1);
SELECT pg_temp.expect_count('Democracy! kept', $q$SELECT pg_temp.democracy(pg_temp.p(1))$q$, 1);

-- ── Admins earn it like anyone ───────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(2));
SELECT pg_temp.expect('admin picks', $q$SELECT pg_temp.vote('award_fun', pg_temp.p(1))$q$, NULL);
RESET ROLE;
SELECT pg_temp.expect_count('admin earns Democracy!', $q$SELECT pg_temp.democracy(pg_temp.p(2))$q$, 1);

-- ── The count keeps the voters ───────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.u(2));
SELECT pg_temp.expect('admin counts', $q$SELECT finalize_season_awards(pg_temp.active())$q$, NULL);
RESET ROLE;
SELECT pg_temp.expect_count('ballots deleted', $q$SELECT count(*) FROM season_award_votes WHERE season_id = pg_temp.active()$q$, 0);
SELECT pg_temp.expect_count('voters survive the count',
  $q$SELECT count(*) FROM season_award_voters WHERE season_id = pg_temp.active()
      AND player_id IN (pg_temp.p(1), pg_temp.p(2))$q$, 2);

-- ── Deleting a player takes their voter rows ─────────────────
DELETE FROM players WHERE id = pg_temp.p(2);
SELECT pg_temp.expect_count('voter row cascades with the player', $q$SELECT pg_temp.voters(pg_temp.p(2))$q$, 0);

SELECT 'democracy achievement: all checks passed' AS result;
ROLLBACK;
