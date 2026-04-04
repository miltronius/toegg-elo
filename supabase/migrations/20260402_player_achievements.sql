CREATE TABLE player_achievements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  unlocked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta          JSONB,
  UNIQUE (player_id, achievement_id)
);

CREATE INDEX idx_player_achievements_player ON player_achievements(player_id);
CREATE INDEX idx_player_achievements_achievement ON player_achievements(achievement_id);

ALTER TABLE player_achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read player_achievements"
  ON player_achievements FOR SELECT USING (true);

CREATE POLICY "Users can insert player_achievements"
  ON player_achievements FOR INSERT
  WITH CHECK (get_my_role() IN ('user', 'admin'));

CREATE POLICY "Users can update player_achievements"
  ON player_achievements FOR UPDATE
  USING (get_my_role() IN ('user', 'admin'));

CREATE POLICY "Admins can delete player_achievements"
  ON player_achievements FOR DELETE
  USING (get_my_role() = 'admin');
