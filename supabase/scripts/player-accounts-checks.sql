-- Rule checks for the player link RPCs (#117). Runs inside a transaction that
-- is always rolled back: fixtures, links and achievement rows all disappear.
-- Usage: supabase db query --linked -f <abs path to this file>
BEGIN;

-- Fixtures. auth.users inserts fire handle_new_user, which makes viewer profiles.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-00000000a001', 'link-user@test.invalid'),
  ('00000000-0000-4000-8000-00000000a002', 'link-admin@test.invalid'),
  ('00000000-0000-4000-8000-00000000a003', 'link-viewer@test.invalid'),
  ('00000000-0000-4000-8000-00000000a004', 'link-user2@test.invalid');
UPDATE profiles SET role = 'user'  WHERE id IN ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000a004');
UPDATE profiles SET role = 'admin' WHERE id = '00000000-0000-4000-8000-00000000a002';
INSERT INTO players (id, name) VALUES
  ('00000000-0000-4000-8000-00000000b001', 'Link Check 1'),
  ('00000000-0000-4000-8000-00000000b002', 'Link Check 2');

-- act as: pass a user id, or NULL for a logged-out (anon) caller
CREATE FUNCTION pg_temp.act_as(uid UUID) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    CASE WHEN uid IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', uid, 'role', 'authenticated')::text END,
    true);
$$;

-- expect(sql, code): run sql, require it to fail with exactly `code`
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

SET LOCAL ROLE anon;
SELECT pg_temp.act_as(NULL);
SELECT pg_temp.expect('anon cannot claim', $q$SELECT claim_player('00000000-0000-4000-8000-00000000b001')$q$, 'permission denied for function claim_player');

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('00000000-0000-4000-8000-00000000a003');
SELECT pg_temp.expect('viewer cannot claim', $q$SELECT claim_player('00000000-0000-4000-8000-00000000b001')$q$, 'not_allowed');
SELECT pg_temp.expect('helper not callable', $q$SELECT link_player_account('00000000-0000-4000-8000-00000000a003', '00000000-0000-4000-8000-00000000b001')$q$, 'permission denied for function link_player_account');

SELECT pg_temp.act_as('00000000-0000-4000-8000-00000000a001');
SELECT pg_temp.expect('user claims', $q$SELECT claim_player('00000000-0000-4000-8000-00000000b001')$q$, NULL);
SELECT pg_temp.expect('claim twice', $q$SELECT claim_player('00000000-0000-4000-8000-00000000b002')$q$, 'account_already_linked');
SELECT pg_temp.expect('user cannot unlink', $q$SELECT unlink_player('00000000-0000-4000-8000-00000000b001')$q$, 'not_allowed');
SELECT pg_temp.expect('user cannot admin-link', $q$SELECT admin_link_player('00000000-0000-4000-8000-00000000a004', '00000000-0000-4000-8000-00000000b002')$q$, 'not_allowed');
SELECT pg_temp.expect('user sees own link', $q$DO $d$ BEGIN IF (SELECT count(*) FROM player_accounts) <> 1 THEN RAISE EXCEPTION 'saw %', (SELECT count(*) FROM player_accounts); END IF; END $d$$q$, NULL);
SELECT pg_temp.expect('no direct insert', $q$INSERT INTO player_accounts (player_id, user_id) VALUES ('00000000-0000-4000-8000-00000000b002', '00000000-0000-4000-8000-00000000a004')$q$, 'permission denied for table player_accounts');

SELECT pg_temp.act_as('00000000-0000-4000-8000-00000000a004');
SELECT pg_temp.expect('claim a claimed player', $q$SELECT claim_player('00000000-0000-4000-8000-00000000b001')$q$, 'player_already_linked');
SELECT pg_temp.expect('other user sees no links', $q$DO $d$ BEGIN IF (SELECT count(*) FROM player_accounts) <> 0 THEN RAISE EXCEPTION 'leak'; END IF; END $d$$q$, NULL);
SELECT pg_temp.expect('get_players exposes is_linked', $q$DO $d$ BEGIN IF NOT (SELECT is_linked FROM get_players() WHERE id = '00000000-0000-4000-8000-00000000b001') THEN RAISE EXCEPTION 'not linked'; END IF; END $d$$q$, NULL);

SELECT pg_temp.act_as('00000000-0000-4000-8000-00000000a002');
SELECT pg_temp.expect('admin cannot link a viewer', $q$SELECT admin_link_player('00000000-0000-4000-8000-00000000a003', '00000000-0000-4000-8000-00000000b002')$q$, 'account_not_eligible');
SELECT pg_temp.expect('achievement granted with linked_at', $q$DO $d$ BEGIN IF NOT EXISTS (SELECT 1 FROM player_achievements pa JOIN player_accounts l USING (player_id) WHERE pa.player_id = '00000000-0000-4000-8000-00000000b001' AND pa.achievement_id = 'linked_account' AND pa.unlocked_at = l.linked_at) THEN RAISE EXCEPTION 'missing'; END IF; END $d$$q$, NULL);
SELECT pg_temp.expect('admin unlinks', $q$SELECT unlink_player('00000000-0000-4000-8000-00000000b001')$q$, NULL);
SELECT pg_temp.expect('unlink revokes achievement', $q$DO $d$ BEGIN IF EXISTS (SELECT 1 FROM player_achievements WHERE player_id = '00000000-0000-4000-8000-00000000b001' AND achievement_id = 'linked_account') THEN RAISE EXCEPTION 'still there'; END IF; END $d$$q$, NULL);
SELECT pg_temp.expect('unlink twice', $q$SELECT unlink_player('00000000-0000-4000-8000-00000000b001')$q$, 'not_linked');
SELECT pg_temp.expect('admin links a user', $q$SELECT admin_link_player('00000000-0000-4000-8000-00000000a004', '00000000-0000-4000-8000-00000000b001')$q$, NULL);

RESET ROLE;
ROLLBACK;
