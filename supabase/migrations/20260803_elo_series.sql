-- ELO rework for the new season: partner weighting + series (best-of-N) results.
--
-- Safe to run on a database in any state, and re-running it is a no-op - these
-- are applied by hand in the Supabase SQL editor, where running a file twice is
-- easy to do.
--
-- Two changes, both taking effect going forward only. Nothing already recorded
-- is recomputed, which is why the historical rows are backfilled to values that
-- describe how they were actually rated rather than how new ones will be.
--
-- 1. `seasons.partner_weight` - how much a player's rating is pulled towards
--    their partner's before expectations are computed. 0 ignores the partner
--    (every season up to now), 0.5 is the standard team-average model, 1/3 is
--    the new default. Per season like `k_factor`, so it can be re-tuned at a
--    season boundary without a deploy. See supabase/functions/_shared/elo.ts.
--
-- 2. `matches.team_a_games` / `team_b_games` / `games` - a recorded match is now
--    a series of N games rather than a single winner. The game counts drive the
--    rating (sum of per-game residuals, the FIDE model); the goals in `games`
--    are display-only and deliberately kept out of the ELO math.
--
-- 3. `elo_history.won` - who actually won, recorded rather than inferred. Under
--    the old one-game model a winner's delta was always positive, so the sign of
--    `elo_change` doubled as the result. Summing per-game residuals breaks that:
--    a favourite who wins a long series narrowly (a 2-1 at E > 2/3) gains
--    nothing or loses rating, and would have been counted as a defeat.

-- ============================================================
-- 1. seasons.partner_weight
-- ============================================================

-- Added with DEFAULT 0 so every existing season is stamped with what it
-- actually ran on, then the default is moved to 1/3 for seasons created later.
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS partner_weight NUMERIC(4,3) NOT NULL DEFAULT 0;
ALTER TABLE seasons ALTER COLUMN partner_weight SET DEFAULT 0.333;

ALTER TABLE seasons DROP CONSTRAINT IF EXISTS seasons_partner_weight_range;
ALTER TABLE seasons ADD CONSTRAINT seasons_partner_weight_range
  CHECK (partner_weight >= 0 AND partner_weight <= 0.5);

-- Bring the running season onto the new settings. Guarded on partner_weight
-- rather than on the old K: every pre-existing row is at 0 and this is the
-- statement that moves it, so a re-run can't undo a later admin change - and
-- unlike a `k_factor = 64` guard it doesn't quietly no-op if the season was
-- started on some other K.
--
-- K is per *game* now, not per recorded match, so 48 is not the drop from 64 it
-- looks like. At even ratings a session moves 48 for a 2-0 and 24 for a 2-1,
-- against a flat 32 under the old one-event-per-match model.
UPDATE seasons
   SET k_factor = 48, partner_weight = 0.333
 WHERE is_active = true AND partner_weight = 0;

-- ============================================================
-- 2. matches: series columns
-- ============================================================
ALTER TABLE matches ADD COLUMN IF NOT EXISTS team_a_games INTEGER NOT NULL DEFAULT 0;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS team_b_games INTEGER NOT NULL DEFAULT 0;

-- Per-game detail: [{"w": "A"|"B", "a": goals|null, "b": goals|null}, ...].
-- NULL marks a row from before series recording - the game counts still say who
-- won what, there is simply no per-game breakdown to show.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS games JSONB;

-- Backfill every pre-series row as a 1-0 series, which is exactly how it was
-- rated. The WHERE keeps a re-run idempotent (and satisfies pg_safeupdate).
UPDATE matches
   SET team_a_games = CASE WHEN winning_team = 'A' THEN 1 ELSE 0 END,
       team_b_games = CASE WHEN winning_team = 'B' THEN 1 ELSE 0 END
 WHERE team_a_games = 0 AND team_b_games = 0;

-- Constraints go on after the backfill, or the existing rows would fail them.

-- A level series has no winner, and `winning_team` has nowhere to put one, so
-- the match form blocks it. Also rules out an empty series.
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_series_decisive;
ALTER TABLE matches ADD CONSTRAINT matches_series_decisive
  CHECK (team_a_games >= 0 AND team_b_games >= 0 AND team_a_games <> team_b_games);

-- `winning_team` stays the column every aggregation reads, so it must not be
-- able to disagree with the tally it is derived from.
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_winner_matches_games;
ALTER TABLE matches ADD CONSTRAINT matches_winner_matches_games
  CHECK ((winning_team = 'A') = (team_a_games > team_b_games));

ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_games_length;
ALTER TABLE matches ADD CONSTRAINT matches_games_length
  CHECK (
    games IS NULL
    OR (jsonb_typeof(games) = 'array'
        AND jsonb_array_length(games) = team_a_games + team_b_games)
  );

-- ============================================================
-- 3. elo_history.won
-- ============================================================

-- Deliberately left nullable, with no "match rows must have a result" check.
-- The migration and the edge function deploy separately, so for the few minutes
-- between them either order has to work: the old function inserts rows without
-- it, and readers fall back to the sign of elo_change for those (see
-- frontend/src/lib/eloHistory.ts). NULL is also the right value for inactivity
-- penalty rows, which have no result at all.
ALTER TABLE elo_history ADD COLUMN IF NOT EXISTS won BOOLEAN;

-- Backfill from the match rather than from the sign of elo_change: an extreme
-- favourite's win could already round to 0 under the old model.
UPDATE elo_history eh
   SET won = (
     (m.winning_team = 'A' AND eh.player_id IN (m.team_a_player_1_id, m.team_a_player_2_id))
     OR
     (m.winning_team = 'B' AND eh.player_id IN (m.team_b_player_1_id, m.team_b_player_2_id))
   )
  FROM matches m
 WHERE eh.match_id = m.id
   AND eh.won IS NULL;

-- ============================================================
-- 4. end_season_and_start_new gains the partner weight
-- ============================================================
-- Dropped rather than replaced: adding a parameter would create an overload and
-- leave the 3-argument version callable.
DROP FUNCTION IF EXISTS end_season_and_start_new(TEXT, INTEGER, NUMERIC);

CREATE OR REPLACE FUNCTION end_season_and_start_new(
  new_season_name     TEXT,
  new_k_factor        INTEGER,
  new_penalty_percent NUMERIC,
  new_partner_weight  NUMERIC DEFAULT 0.333
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
