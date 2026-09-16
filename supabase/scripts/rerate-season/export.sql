-- Snapshot of the active season, as the input to rerate.ts. Read-only.
--
--   supabase db query --linked -o json -f supabase/scripts/rerate-season/export.sql > season.json
--
-- Everything is ordered the way the replay consumes it (created_at, then id as
-- a tiebreak), so the script never has to guess at chronology.
WITH s AS (
  SELECT id, number, name, k_factor, partner_weight
    FROM seasons
   WHERE is_active
)
SELECT json_build_object(
  'season', (SELECT row_to_json(s) FROM s),
  'players', (
    SELECT json_agg(json_build_object(
             'id', p.id, 'name', p.name, 'current_elo', p.current_elo)
           ORDER BY p.name)
      FROM players p
  ),
  'seasonStats', (
    SELECT json_agg(json_build_object(
             'player_id', pss.player_id,
             'elo_at_start', pss.elo_at_start,
             'current_season_elo', pss.current_season_elo,
             'wins', pss.wins,
             'losses', pss.losses)
           ORDER BY pss.player_id)
      FROM player_season_stats pss
     WHERE pss.season_id = (SELECT id FROM s)
  ),
  'matches', (
    SELECT json_agg(json_build_object(
             'id', m.id,
             'created_at', m.created_at,
             'team_a', json_build_array(m.team_a_player_1_id, m.team_a_player_2_id),
             'team_b', json_build_array(m.team_b_player_1_id, m.team_b_player_2_id),
             'team_a_games', m.team_a_games,
             'team_b_games', m.team_b_games,
             'winning_team', m.winning_team)
           ORDER BY m.created_at, m.id)
      FROM matches m
     WHERE m.season_id = (SELECT id FROM s)
  ),
  'history', (
    SELECT json_agg(json_build_object(
             'id', eh.id,
             'player_id', eh.player_id,
             'match_id', eh.match_id,
             'created_at', eh.created_at,
             'elo_before', eh.elo_before,
             'elo_after', eh.elo_after,
             'elo_change', eh.elo_change,
             'won', eh.won,
             'penalty_type', eh.penalty_type)
           ORDER BY eh.created_at, eh.id)
      FROM elo_history eh
     WHERE eh.season_id = (SELECT id FROM s)
  )
) AS data;
