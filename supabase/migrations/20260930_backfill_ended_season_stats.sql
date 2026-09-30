-- Give players who were added mid-season, in seasons that have since ended, the
-- player_season_stats row they never got.
--
-- Safe to run on a database in any state, and re-running it is a no-op - these
-- are applied by hand in the Supabase SQL editor, where running a file twice is
-- easy to do.
--
-- 20260916_season_stats_for_new_players.sql fixed this going forward (the
-- on_player_created trigger) and backfilled the season that was running then,
-- but not the seasons already over. Their players played and moved rating, yet
-- are missing from those seasons' boards - and since season placements (#120)
-- read the stored standings, they can't place either.
--
-- Same reconstruction as that migration's backfill: rebuilt from the season's
-- elo_history, only for (player, season) pairs that have history, so nobody who
-- never played a season gets a row for it.
--
-- Follow it with Admin -> Recompute (the destructive one): a player added to a
-- season's standings can move others down a tier, and the per-match recompute
-- never revokes an achievement.

INSERT INTO player_season_stats
  (player_id, season_id, elo_at_start, current_season_elo, wins, losses, last_match_at)
SELECT p.id,
       s.id,
       h.first_elo_before,
       1500 + h.sum_change,
       h.wins,
       h.losses,
       h.last_match_at
  FROM players p
  CROSS JOIN seasons s
  JOIN LATERAL (
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
    HAVING count(*) > 0
  ) h ON true
 WHERE NOT s.is_active
ON CONFLICT (player_id, season_id) DO NOTHING;
