-- Fix 1: increment_season_stats uses delta so season ELO is normalized to 1500
--         (instead of overwriting with raw all-time ELO)
-- Fix 2: end_season_and_start_new no longer resets players all-time stats;
--         elo_at_start captures the player's real ELO at season start

CREATE OR REPLACE FUNCTION increment_season_stats(
  p_player_id UUID,
  p_season_id UUID,
  p_elo_before INTEGER,
  p_elo_after  INTEGER,
  p_won        BOOLEAN
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE player_season_stats SET
    current_season_elo = current_season_elo + (p_elo_after - p_elo_before),
    wins   = wins   + CASE WHEN p_won     THEN 1 ELSE 0 END,
    losses = losses + CASE WHEN NOT p_won THEN 1 ELSE 0 END,
    last_match_at = NOW()
  WHERE player_id = p_player_id AND season_id = p_season_id;
END;
$$;

CREATE OR REPLACE FUNCTION end_season_and_start_new(
  new_season_name     TEXT,
  new_k_factor        INTEGER,
  new_penalty_percent NUMERIC
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

  INSERT INTO seasons (number, name, k_factor, inactivity_penalty_percent, started_at, is_active)
  VALUES (v_old_number + 1, new_season_name, new_k_factor, new_penalty_percent, NOW(), true)
  RETURNING id INTO v_new_id;

  -- All-time stats (players.current_elo, wins, losses) are NOT touched.
  -- Season starts normalized at 1500; elo_at_start records where each player actually was.
  INSERT INTO player_season_stats
    (player_id, season_id, elo_at_start, current_season_elo, wins, losses)
  SELECT id, v_new_id, current_elo, 1500, 0, 0 FROM players;

  RETURN v_new_id;
END;
$$;
