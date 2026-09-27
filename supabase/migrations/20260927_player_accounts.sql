-- Link an account to its player (#117). One account <-> one player. The link
-- lives in its own table rather than on profiles so "is this player claimed"
-- can be exposed (get_players.is_linked) without exposing which account.
-- There are no write policies: every write goes through the RPCs below, which
-- also keep the linked_account achievement in step with the link.

CREATE TABLE player_accounts (
  player_id UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE player_accounts ENABLE ROW LEVEL SECURITY;

-- Own link (AuthContext.myPlayerId) for everyone; every link for admins
-- (User Management). The service role bypasses RLS (calculate-elo recompute).
CREATE POLICY "Read own link, admins read all" ON player_accounts
  FOR SELECT USING (
    user_id = (SELECT auth.uid()) OR get_my_role() = 'admin'
  );

-- Belt and braces: anon/authenticated hold table-level grants on everything in
-- public, and RLS with no write policy already refuses writes - but say it.
REVOKE INSERT, UPDATE, DELETE ON player_accounts FROM anon, authenticated;

-- Shared by claim_player and admin_link_player. Not callable by clients: the
-- callers check *who* may link, this checks *what* may be linked.
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
  INSERT INTO player_achievements (player_id, achievement_id, unlocked_at, meta)
  VALUES (p_player_id, 'linked_account', v_linked_at, NULL)
  ON CONFLICT (player_id, achievement_id)
  DO UPDATE SET unlocked_at = EXCLUDED.unlocked_at, meta = NULL;
END;
$$;

-- Supabase's default privileges grant EXECUTE on new public functions to
-- anon/authenticated; this one must not be reachable from a client.
REVOKE ALL ON FUNCTION link_player_account(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION claim_player(p_player_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- COALESCE: get_my_role() is NULL for a logged-out caller, and NULL NOT IN
  -- (...) is NULL, which IF treats as false - i.e. it would let them through.
  IF COALESCE(get_my_role(), '') NOT IN ('user', 'admin') THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  PERFORM link_player_account(auth.uid(), p_player_id);
END;
$$;

CREATE OR REPLACE FUNCTION admin_link_player(p_user_id UUID, p_player_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(get_my_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  PERFORM link_player_account(p_user_id, p_player_id);
END;
$$;

CREATE OR REPLACE FUNCTION unlink_player(p_player_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(get_my_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  DELETE FROM player_accounts WHERE player_id = p_player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_linked';
  END IF;
  -- The per-match recompute never deletes, so the achievement would otherwise
  -- survive until the next admin recompute.
  DELETE FROM player_achievements
  WHERE player_id = p_player_id AND achievement_id = 'linked_account';
END;
$$;

REVOKE ALL ON FUNCTION claim_player(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION admin_link_player(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION unlink_player(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION claim_player(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_link_player(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION unlink_player(UUID) TO authenticated;

-- get_players() gains is_linked. A function's result columns can't be changed
-- by CREATE OR REPLACE, so drop and recreate (and re-grant).
DROP FUNCTION get_players();
CREATE FUNCTION get_players()
RETURNS TABLE (
  id uuid,
  name text,
  current_elo int,
  matches_played int,
  wins int,
  losses int,
  created_at timestamptz,
  anonymous_name text,
  is_linked boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    CASE WHEN get_my_role() IN ('user', 'admin')
         THEN p.name
         ELSE COALESCE(p.anonymous_name, 'Anonymous') END AS name,
    p.current_elo,
    p.matches_played,
    p.wins,
    p.losses,
    p.created_at,
    CASE WHEN get_my_role() IN ('user', 'admin')
         THEN p.anonymous_name
         ELSE NULL END AS anonymous_name,
    -- Only whether a player is claimed, never by whom.
    EXISTS (SELECT 1 FROM player_accounts pa WHERE pa.player_id = p.id) AS is_linked
  FROM players p
  ORDER BY p.current_elo DESC;
$$;

GRANT EXECUTE ON FUNCTION get_players() TO anon, authenticated;
