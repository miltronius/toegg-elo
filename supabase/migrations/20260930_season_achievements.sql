-- Repeatable per-season achievements (#120). A row with season_id NULL is a
-- one-time achievement (every achievement before this migration); a row with a
-- season is earned again each season. NULLS NOT DISTINCT keeps the one-time
-- rows unique on (player_id, achievement_id) exactly as before. Needs PG 15+.
--
-- Safe to re-run: these are applied by hand in the SQL editor.
--
-- Release order: apply this, then deploy calculate-elo, then the frontend.
-- Until the function is redeployed its upsert names the old conflict target
-- and fails (non-fatally - the match still records).

ALTER TABLE player_achievements
  ADD COLUMN IF NOT EXISTS season_id UUID REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE player_achievements
  DROP CONSTRAINT IF EXISTS player_achievements_player_id_achievement_id_key;
ALTER TABLE player_achievements
  DROP CONSTRAINT IF EXISTS player_achievements_player_achievement_season_key;
ALTER TABLE player_achievements
  ADD CONSTRAINT player_achievements_player_achievement_season_key
  UNIQUE NULLS NOT DISTINCT (player_id, achievement_id, season_id);

CREATE INDEX IF NOT EXISTS idx_player_achievements_season
  ON player_achievements(season_id) WHERE season_id IS NOT NULL;

-- Unchanged from 20260927_player_accounts.sql except the ON CONFLICT target:
-- the old (player_id, achievement_id) key no longer exists, and an ON CONFLICT
-- that names no constraint is an error, so every claim would fail without this.
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
  INSERT INTO player_achievements (player_id, achievement_id, unlocked_at, meta, season_id)
  VALUES (p_player_id, 'linked_account', v_linked_at, NULL, NULL)
  ON CONFLICT (player_id, achievement_id, season_id)
  DO UPDATE SET unlocked_at = EXCLUDED.unlocked_at, meta = NULL;
END;
$$;

REVOKE ALL ON FUNCTION link_player_account(UUID, UUID) FROM PUBLIC, anon, authenticated;
