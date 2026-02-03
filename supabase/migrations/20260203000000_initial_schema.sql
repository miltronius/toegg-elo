-- Create players table
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  current_elo INTEGER NOT NULL DEFAULT 1500,
  matches_played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create matches table
CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_a_player_1_id UUID NOT NULL REFERENCES players(id),
  team_a_player_2_id UUID NOT NULL REFERENCES players(id),
  team_b_player_1_id UUID NOT NULL REFERENCES players(id),
  team_b_player_2_id UUID NOT NULL REFERENCES players(id),
  winning_team TEXT NOT NULL CHECK (winning_team IN ('A', 'B')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create elo_history table to track rating changes over time
CREATE TABLE elo_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id),
  match_id UUID NOT NULL REFERENCES matches(id),
  elo_before INTEGER NOT NULL,
  elo_after INTEGER NOT NULL,
  elo_change INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX idx_players_elo ON players(current_elo DESC);
CREATE INDEX idx_matches_created_at ON matches(created_at DESC);
CREATE INDEX idx_elo_history_player_id ON elo_history(player_id);
CREATE INDEX idx_elo_history_match_id ON elo_history(match_id);

-- Enable Row Level Security (RLS) - for now allow all operations
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE elo_history ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (adjust later if you add auth)
CREATE POLICY "Allow public read access on players" ON players FOR SELECT USING (true);
CREATE POLICY "Allow public insert on players" ON players FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on players" ON players FOR UPDATE USING (true);

CREATE POLICY "Allow public read access on matches" ON matches FOR SELECT USING (true);
CREATE POLICY "Allow public insert on matches" ON matches FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public read access on elo_history" ON elo_history FOR SELECT USING (true);
CREATE POLICY "Allow public insert on elo_history" ON elo_history FOR INSERT WITH CHECK (true);
