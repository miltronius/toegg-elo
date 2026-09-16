-- Drop the open policies left behind by 20260203_deletion_policies.sql.
--
-- Safe to run on a database in any state, and re-running it is a no-op - these
-- are applied by hand in the Supabase SQL editor, where running a file twice is
-- easy to do.
--
-- 20260311_auth_and_roles.sql was meant to remove these when it introduced the
-- role-based policies, but it dropped them under different names ("Allow delete
-- on players" rather than "Allow public delete on players"), so on any database
-- that had run the deletion-policies file they survived alongside the new ones.
-- Permissive policies are OR'd together, and `anon` holds table-level DELETE and
-- INSERT grants, so the anon key shipped in the frontend bundle was enough to
-- delete every player, match and rating history row, or insert matches directly.
--
-- Nothing replaces them: every one is shadowed by a role-based policy from
-- 20260311_auth_and_roles.sql ("Admins can delete ...", "Users and admins can
-- insert matches", "Anyone can read ..."). The two read policies are harmless
-- duplicates, dropped so the policy list says what it means.

DROP POLICY IF EXISTS "Allow public delete on players"      ON players;
DROP POLICY IF EXISTS "Allow public delete on matches"      ON matches;
DROP POLICY IF EXISTS "Allow public delete on elo_history"  ON elo_history;
DROP POLICY IF EXISTS "Allow public insert on matches"      ON matches;
DROP POLICY IF EXISTS "Allow public read access on players" ON players;
DROP POLICY IF EXISTS "Allow public read access on matches" ON matches;
