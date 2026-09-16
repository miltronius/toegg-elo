-- Close player_season_stats to anonymous writes.
--
-- Safe to run on a database in any state, and re-running it is a no-op - these
-- are applied by hand in the Supabase SQL editor, where running a file twice is
-- easy to do.
--
-- 20260404_seasons.sql created "Service role manages player_season_stats" as
-- FOR ALL USING (true) WITH CHECK (true) with no TO clause, so it applied to
-- every role - the anon key could rewrite any player's season rating and record.
-- It never did what its name says either: the service role bypasses RLS, so the
-- edge function and increment_season_stats need no policy at all, and neither do
-- end_season_and_start_new / apply_inactivity_penalties (SECURITY DEFINER and
-- pg_cron respectively).
--
-- The one write that does go through RLS is deleteMatch in
-- frontend/src/lib/supabase.ts, which recomputes the affected players' season
-- stats from the browser. Deleting a match is admin-only, so that is the policy.
-- Rows are only ever inserted by SECURITY DEFINER functions and removed by
-- ON DELETE CASCADE, neither of which consults RLS, so no INSERT or DELETE
-- policy is needed.

DROP POLICY IF EXISTS "Service role manages player_season_stats" ON player_season_stats;

DROP POLICY IF EXISTS "Admins can update player_season_stats" ON player_season_stats;
CREATE POLICY "Admins can update player_season_stats" ON player_season_stats
  FOR UPDATE
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');
