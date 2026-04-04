-- Seasons feature migration
-- Creates: seasons, player_season_stats tables
-- Alters: matches (+ season_id), elo_history (+ season_id, match_id nullable, + penalty_type)
-- Adds: end_season_and_start_new, increment_season_stats, apply_inactivity_penalties functions
-- Backfills: Season 1 for all existing data

-- ============================================================
-- 1. seasons table
-- ============================================================
CREATE TABLE seasons (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number                      INTEGER NOT NULL UNIQUE,
  name                        TEXT NOT NULL,
  k_factor                    INTEGER NOT NULL DEFAULT 32
                                CHECK (k_factor BETWEEN 1 AND 256),
  inactivity_penalty_percent  NUMERIC(4,2) NOT NULL DEFAULT 0
                                CHECK (inactivity_penalty_percent >= 0
                                  AND inactivity_penalty_percent <= 5),
  started_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at                    TIMESTAMPTZ,
  is_active                   BOOLEAN NOT NULL DEFAULT false,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce at most one active season at a time
CREATE UNIQUE INDEX idx_seasons_one_active ON seasons (is_active) WHERE is_active = true;

ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read seasons" ON seasons FOR SELECT USING (true);
CREATE POLICY "Admins can insert seasons" ON seasons FOR INSERT WITH CHECK (get_my_role() = 'admin');
CREATE POLICY "Admins can update seasons" ON seasons FOR UPDATE USING (get_my_role() = 'admin');

-- ============================================================
-- 2. Insert Season 1 retroactively
-- ============================================================
INSERT INTO seasons (number, name, k_factor, inactivity_penalty_percent, started_at, is_active)
SELECT
  1,
  'Season 1',
  32,
  0,
  COALESCE((SELECT MIN(created_at) FROM matches), NOW()),
  true;

-- ============================================================
-- 3. Add season_id to matches
-- ============================================================
ALTER TABLE matches ADD COLUMN season_id UUID REFERENCES seasons(id);
UPDATE matches SET season_id = (SELECT id FROM seasons WHERE number = 1);
ALTER TABLE matches ALTER COLUMN season_id SET NOT NULL;
CREATE INDEX idx_matches_season_id ON matches(season_id);

-- ============================================================
-- 4. Add season_id to elo_history, make match_id nullable for penalty entries
-- ============================================================
ALTER TABLE elo_history ALTER COLUMN match_id DROP NOT NULL;
ALTER TABLE elo_history ADD COLUMN penalty_type TEXT
  CHECK (penalty_type IN ('inactivity') OR penalty_type IS NULL);

ALTER TABLE elo_history ADD COLUMN season_id UUID REFERENCES seasons(id);
UPDATE elo_history eh SET season_id = m.season_id FROM matches m WHERE eh.match_id = m.id;
ALTER TABLE elo_history ALTER COLUMN season_id SET NOT NULL;
CREATE INDEX idx_elo_history_season_id ON elo_history(season_id);

-- ============================================================
-- 5. player_season_stats table
-- ============================================================
CREATE TABLE player_season_stats (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id           UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  season_id           UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  elo_at_start        INTEGER NOT NULL DEFAULT 1500,
  current_season_elo  INTEGER NOT NULL DEFAULT 1500,
  wins                INTEGER NOT NULL DEFAULT 0,
  losses              INTEGER NOT NULL DEFAULT 0,
  last_match_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_id, season_id)
);
CREATE INDEX idx_pss_season ON player_season_stats(season_id);
CREATE INDEX idx_pss_player ON player_season_stats(player_id);

ALTER TABLE player_season_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read player_season_stats" ON player_season_stats FOR SELECT USING (true);
-- Edge function uses service role key for writes; no anon/user writes needed
CREATE POLICY "Service role manages player_season_stats" ON player_season_stats
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 6. Backfill Season 1 player_season_stats
-- ============================================================
INSERT INTO player_season_stats
  (player_id, season_id, elo_at_start, current_season_elo, wins, losses, last_match_at)
SELECT
  p.id,
  (SELECT id FROM seasons WHERE number = 1),
  1500,
  p.current_elo,
  p.wins,
  p.losses,
  (SELECT MAX(m.created_at) FROM matches m
   WHERE m.team_a_player_1_id = p.id
      OR m.team_a_player_2_id = p.id
      OR m.team_b_player_1_id = p.id
      OR m.team_b_player_2_id = p.id)
FROM players p;

-- ============================================================
-- 7. Helper: increment_season_stats — called by edge function per match
-- ============================================================
CREATE OR REPLACE FUNCTION increment_season_stats(
  p_player_id UUID,
  p_season_id UUID,
  p_elo_after INTEGER,
  p_won       BOOLEAN
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE player_season_stats SET
    current_season_elo = p_elo_after,
    wins   = wins   + CASE WHEN p_won     THEN 1 ELSE 0 END,
    losses = losses + CASE WHEN NOT p_won THEN 1 ELSE 0 END,
    last_match_at = NOW()
  WHERE player_id = p_player_id AND season_id = p_season_id;
END;
$$;

-- ============================================================
-- 8. end_season_and_start_new — atomic season transition (admin only via RPC)
-- ============================================================
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

  -- Full ELO reset: all players to 1500
  UPDATE players SET current_elo = 1500;

  -- Create per-season stats rows for all players (starting at 1500)
  INSERT INTO player_season_stats
    (player_id, season_id, elo_at_start, current_season_elo, wins, losses)
  SELECT id, v_new_id, 1500, 1500, 0, 0 FROM players;

  RETURN v_new_id;
END;
$$;

-- ============================================================
-- 9. apply_inactivity_penalties — run by pg_cron every Monday or by admin ad hoc
-- ============================================================
CREATE OR REPLACE FUNCTION apply_inactivity_penalties()
RETURNS TABLE(
  out_player_id UUID,
  out_old_elo   INT,
  out_new_elo   INT,
  out_elo_change INT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_season_id  UUID;
  v_penalty_pct NUMERIC;
  v_cutoff     TIMESTAMPTZ;
  r            RECORD;
  v_new_elo    INT;
BEGIN
  SELECT id, inactivity_penalty_percent
    INTO v_season_id, v_penalty_pct
    FROM seasons WHERE is_active = true;

  -- Nothing to do if no active season or no penalty configured
  IF v_season_id IS NULL OR v_penalty_pct = 0 THEN
    RETURN;
  END IF;

  -- 7 calendar days back (covers 5 business days for a Mon–Fri week)
  v_cutoff := NOW() - INTERVAL '7 days';

  FOR r IN
    SELECT pss.player_id, pss.current_season_elo
    FROM player_season_stats pss
    WHERE pss.season_id = v_season_id
      AND pss.current_season_elo > 100
      AND (pss.last_match_at IS NULL OR pss.last_match_at < v_cutoff)
  LOOP
    v_new_elo := GREATEST(100, ROUND(r.current_season_elo * (1 - v_penalty_pct / 100)));

    UPDATE player_season_stats
      SET current_season_elo = v_new_elo
      WHERE player_id = r.player_id AND season_id = v_season_id;

    UPDATE players SET current_elo = v_new_elo WHERE id = r.player_id;

    INSERT INTO elo_history
      (player_id, season_id, elo_before, elo_after, elo_change, penalty_type)
    VALUES
      (r.player_id, v_season_id, r.current_season_elo, v_new_elo,
       v_new_elo - r.current_season_elo, 'inactivity');

    out_player_id  := r.player_id;
    out_old_elo    := r.current_season_elo;
    out_new_elo    := v_new_elo;
    out_elo_change := v_new_elo - r.current_season_elo;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ============================================================
-- 10. pg_cron schedule — enable pg_cron extension first via Supabase dashboard
-- Then uncomment and run the line below:
-- SELECT cron.schedule('inactivity-penalty-weekly', '0 8 * * 1', 'SELECT apply_inactivity_penalties()');
-- ============================================================
