-- Anonymous player names for viewers / logged-out users.
-- Real names must never reach a non-(user/admin) client, so name swapping is done
-- server-side in a SECURITY DEFINER RPC and the base players table is locked down.

-- 1. Store the per-player anonymous (musician) name. Nullable; backfilled separately.
ALTER TABLE players ADD COLUMN IF NOT EXISTS anonymous_name TEXT;

-- 2. Read RPC: returns the real name only to user/admin, the anonymous name to everyone else.
--    SECURITY DEFINER bypasses RLS so it can serve all callers while the base table SELECT
--    is restricted below. auth.uid() inside the function still reflects the caller's JWT,
--    so get_my_role() resolves correctly (NULL for logged-out visitors).
CREATE OR REPLACE FUNCTION get_players()
RETURNS TABLE (
  id uuid,
  name text,
  current_elo int,
  matches_played int,
  wins int,
  losses int,
  created_at timestamptz,
  anonymous_name text
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
         ELSE NULL END AS anonymous_name
  FROM players p
  ORDER BY p.current_elo DESC;
$$;

GRANT EXECUTE ON FUNCTION get_players() TO anon, authenticated;

-- 3. Lock down direct reads of the base table so a viewer with the anon key cannot
--    bypass the RPC and read raw rows (including real names).
DROP POLICY IF EXISTS "Anyone can read players" ON players;
CREATE POLICY "Users and admins can read players" ON players
  FOR SELECT USING (get_my_role() IN ('user', 'admin'));
