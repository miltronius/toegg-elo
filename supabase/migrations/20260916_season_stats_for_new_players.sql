-- Give players created mid-season a player_season_stats row.
--
-- Safe to run on a database in any state, and re-running it is a no-op - these
-- are applied by hand in the Supabase SQL editor, where running a file twice is
-- easy to do.
--
-- Season rows were only ever created by end_season_and_start_new, for the
-- players that existed at that moment. A player added afterwards had none, and
-- nothing noticed:
--
--   - calculate-elo falls back to the all-time rating when a season row is
--     missing, which for a brand-new player is the same 1500, so the ratings
--     themselves came out right;
--   - increment_season_stats is a bare UPDATE, so every match they played
--     updated zero rows and the season never recorded any of it.
--
-- The visible result is a player who has played and moved rating, but is absent
-- from the season leaderboard, while the season's ratings no longer sum to the
-- pool (the missing player's deltas are exactly the gap).

-- ============================================================
-- 1. New players join the running season
-- ============================================================
-- SECURITY DEFINER because players are created from the browser by `user`
-- roles, and player_season_stats has no INSERT policy for them - nor should it.
-- A trigger function cannot be called directly, so this exposes nothing.
CREATE OR REPLACE FUNCTION create_season_stats_for_new_player()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- elo_at_start is the all-time rating at the moment they joined, matching
  -- what end_season_and_start_new records for everyone else.
  INSERT INTO player_season_stats
    (player_id, season_id, elo_at_start, current_season_elo, wins, losses)
  SELECT NEW.id, s.id, NEW.current_elo, 1500, 0, 0
    FROM seasons s
   WHERE s.is_active
  ON CONFLICT (player_id, season_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_player_created ON players;
CREATE TRIGGER on_player_created
  AFTER INSERT ON players
  FOR EACH ROW EXECUTE FUNCTION create_season_stats_for_new_player();

-- ============================================================
-- 2. Backfill players who already fell through
-- ============================================================
-- Rebuilt from the season's elo_history rather than defaulted to 1500 / 0-0, so
-- a player who has already played lands where their matches put them. Players
-- with no rows this season get the same fresh row the trigger would have made.
INSERT INTO player_season_stats
  (player_id, season_id, elo_at_start, current_season_elo, wins, losses, last_match_at)
SELECT p.id,
       s.id,
       COALESCE(h.first_elo_before, p.current_elo),
       1500 + COALESCE(h.sum_change, 0),
       COALESCE(h.wins, 0),
       COALESCE(h.losses, 0),
       h.last_match_at
  FROM players p
  CROSS JOIN seasons s
  LEFT JOIN LATERAL (
    SELECT (array_agg(eh.elo_before ORDER BY eh.created_at, eh.id))[1] AS first_elo_before,
           sum(eh.elo_change)                                           AS sum_change,
           -- `won` falls back to the sign rule for rows written before the
           -- column existed, the same way frontend/src/lib/eloHistory.ts does.
           count(*) FILTER (WHERE eh.match_id IS NOT NULL
                              AND COALESCE(eh.won, eh.elo_change > 0))     AS wins,
           count(*) FILTER (WHERE eh.match_id IS NOT NULL
                              AND NOT COALESCE(eh.won, eh.elo_change > 0)) AS losses,
           max(eh.created_at) FILTER (WHERE eh.match_id IS NOT NULL)      AS last_match_at
      FROM elo_history eh
     WHERE eh.player_id = p.id AND eh.season_id = s.id
  ) h ON true
 WHERE s.is_active
ON CONFLICT (player_id, season_id) DO NOTHING;
