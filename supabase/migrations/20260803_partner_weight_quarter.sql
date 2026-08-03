-- Partner weight: 1/3 → 1/4. Your own rating now counts triple, not double.
--
-- Safe to run on a database in any state, and re-running it is a no-op - these
-- are applied by hand in the Supabase SQL editor, where running a file twice is
-- easy to do.
--
-- Nothing already recorded is recomputed; there is no re-rating path. Matches
-- rated at 1/3 keep the deltas they were given, so the running season's
-- standings are a blend of the two once this is applied. Drop the UPDATE at the
-- bottom and the change waits for the next season boundary instead.
--
-- 0.25 rather than 1/4 on purpose: NUMERIC(4,3) stores 1/3 as 0.333, which is
-- then no longer the constant the frontend and the edge function compare
-- against. A quarter round-trips exactly. See supabase/functions/_shared/elo.ts.

-- ============================================================
-- 1. Default for seasons created later
-- ============================================================
ALTER TABLE seasons ALTER COLUMN partner_weight SET DEFAULT 0.25;

-- The existing CHECK (0 .. 0.5) already admits 0.25 and is left alone.

-- ============================================================
-- 2. end_season_and_start_new's default argument
-- ============================================================
-- CREATE OR REPLACE rather than DROP + CREATE: the signature is unchanged, so
-- there is no overload to leave callable and nothing to re-grant. Only the
-- default moves - the frontend always passes the weight explicitly
-- (frontend/src/lib/supabase.ts), so this covers direct SQL callers.
CREATE OR REPLACE FUNCTION end_season_and_start_new(
  new_season_name     TEXT,
  new_k_factor        INTEGER,
  new_penalty_percent NUMERIC,
  new_partner_weight  NUMERIC DEFAULT 0.25
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_old_id     UUID;
  v_old_number INTEGER;
  v_new_id     UUID;
BEGIN
  IF get_my_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can end seasons';
  END IF;

  SELECT id, number INTO v_old_id, v_old_number FROM seasons WHERE is_active = true;
  IF v_old_id IS NULL THEN
    RAISE EXCEPTION 'No active season found';
  END IF;

  UPDATE seasons SET is_active = false, ended_at = NOW() WHERE id = v_old_id;

  INSERT INTO seasons (number, name, k_factor, inactivity_penalty_percent,
                       partner_weight, started_at, is_active)
  VALUES (v_old_number + 1, new_season_name, new_k_factor, new_penalty_percent,
          new_partner_weight, NOW(), true)
  RETURNING id INTO v_new_id;

  -- All-time stats (players.current_elo, wins, losses) are NOT touched.
  -- Season starts normalized at 1500; elo_at_start records where each player actually was.
  INSERT INTO player_season_stats
    (player_id, season_id, elo_at_start, current_season_elo, wins, losses)
  SELECT id, v_new_id, current_elo, 1500, 0, 0 FROM players;

  RETURN v_new_id;
END;
$$;

-- ============================================================
-- 3. Bring the running season onto the new weight
-- ============================================================
-- Guarded on the old default the same way 20260803_elo_series.sql guarded on 0:
-- a re-run can't stomp a weight an admin has since chosen deliberately, and it
-- no-ops on a season that was never on 1/3.
UPDATE seasons
   SET partner_weight = 0.25
 WHERE is_active = true AND partner_weight = 0.333;
