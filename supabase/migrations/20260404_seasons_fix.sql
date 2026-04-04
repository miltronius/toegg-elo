-- Fix: add WHERE clause to UPDATE inside end_season_and_start_new
-- to satisfy pg_safeupdate (which blocks UPDATE/DELETE without WHERE)

CREATE OR REPLACE FUNCTION end_season_and_start_new(
  new_season_name    TEXT,
  new_k_factor       INTEGER,
  new_penalty_percent NUMERIC
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_old_id     UUID;
  v_old_number INTEGER;
  v_new_id     UUID;
BEGIN
  -- Verify caller is admin
  IF get_my_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can end seasons';
  END IF;

  SELECT id, number INTO v_old_id, v_old_number FROM seasons WHERE is_active = true;
  IF v_old_id IS NULL THEN
    RAISE EXCEPTION 'No active season found';
  END IF;

  -- End the current season
  UPDATE seasons SET is_active = false, ended_at = NOW() WHERE id = v_old_id;

  -- Create new season
  INSERT INTO seasons (number, name, k_factor, inactivity_penalty_percent, started_at, is_active)
  VALUES (v_old_number + 1, new_season_name, new_k_factor, new_penalty_percent, NOW(), true)
  RETURNING id INTO v_new_id;

  -- Full ELO reset: all players to 1500 (WHERE id IS NOT NULL satisfies pg_safeupdate)
  UPDATE players SET current_elo = 1500 WHERE id IS NOT NULL;

  -- Create per-season stats rows for all players (starting at 1500)
  INSERT INTO player_season_stats
    (player_id, season_id, elo_at_start, current_season_elo, wins, losses)
  SELECT id, v_new_id, 1500, 1500, 0, 0 FROM players;

  RETURN v_new_id;
END;
$$;
