-- Create profiles table linked to auth.users
CREATE TABLE profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'user', 'admin')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Helper function to get the current user's role (SECURITY DEFINER bypasses RLS)
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Profiles policies
CREATE POLICY "Users can read own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Admins can read all profiles" ON profiles
  FOR SELECT USING (get_my_role() = 'admin');

CREATE POLICY "Admins can update profiles" ON profiles
  FOR UPDATE USING (get_my_role() = 'admin');

-- Trigger: auto-create a viewer profile on every new signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (NEW.id, NEW.email, 'viewer');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Drop existing open policies
DROP POLICY IF EXISTS "Allow public read access on players" ON players;
DROP POLICY IF EXISTS "Allow public insert on players" ON players;
DROP POLICY IF EXISTS "Allow public update on players" ON players;
DROP POLICY IF EXISTS "Allow public read access on matches" ON matches;
DROP POLICY IF EXISTS "Allow public insert on matches" ON matches;
DROP POLICY IF EXISTS "Allow public read access on elo_history" ON elo_history;
DROP POLICY IF EXISTS "Allow public insert on elo_history" ON elo_history;
DROP POLICY IF EXISTS "Allow delete on players" ON players;
DROP POLICY IF EXISTS "Allow delete on matches" ON matches;
DROP POLICY IF EXISTS "Allow delete on elo_history" ON elo_history;

-- Players policies
CREATE POLICY "Anyone can read players" ON players
  FOR SELECT USING (true);

CREATE POLICY "Users and admins can insert players" ON players
  FOR INSERT WITH CHECK (get_my_role() IN ('user', 'admin'));

CREATE POLICY "Users and admins can update players" ON players
  FOR UPDATE USING (get_my_role() IN ('user', 'admin'));

CREATE POLICY "Admins can delete players" ON players
  FOR DELETE USING (get_my_role() = 'admin');

-- Matches policies
CREATE POLICY "Anyone can read matches" ON matches
  FOR SELECT USING (true);

CREATE POLICY "Users and admins can insert matches" ON matches
  FOR INSERT WITH CHECK (get_my_role() IN ('user', 'admin'));

CREATE POLICY "Admins can delete matches" ON matches
  FOR DELETE USING (get_my_role() = 'admin');

-- Elo history policies
CREATE POLICY "Anyone can read elo_history" ON elo_history
  FOR SELECT USING (true);

CREATE POLICY "Users and admins can insert elo_history" ON elo_history
  FOR INSERT WITH CHECK (get_my_role() IN ('user', 'admin'));

CREATE POLICY "Admins can delete elo_history" ON elo_history
  FOR DELETE USING (get_my_role() = 'admin');
