CREATE TABLE team_names (
  player_id_lo  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player_id_hi  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name          TEXT,
  alias_1       TEXT,
  alias_2       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id_lo, player_id_hi),
  CONSTRAINT canonical_order CHECK (player_id_lo < player_id_hi)
);

ALTER TABLE team_names ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read team_names" ON team_names
  FOR SELECT USING (true);

CREATE POLICY "Users and admins can insert team_names" ON team_names
  FOR INSERT WITH CHECK (get_my_role() IN ('user', 'admin'));

CREATE POLICY "Users and admins can update team_names" ON team_names
  FOR UPDATE USING (get_my_role() IN ('user', 'admin'));

CREATE POLICY "Admins can delete team_names" ON team_names
  FOR DELETE USING (get_my_role() = 'admin');

CREATE INDEX idx_team_names_lo ON team_names(player_id_lo);
CREATE INDEX idx_team_names_hi ON team_names(player_id_hi);
