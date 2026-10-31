-- Democracy! - a per-season achievement for voting in the Season Awards.
-- Earned the moment a voter's first pick of the season saves; later picks,
-- changes and clearing it again don't move or remove it.
--
-- The ballots can't be what it's derived from: counting deletes them
-- (finalize_season_awards), and the admin's "Recompute achievements" rebuilds
-- every row from stored records. So each season's voters are kept in a table
-- of their own - who voted and when, never for whom.
--
-- Safe to re-run: these are applied by hand in the SQL editor.
--
-- Release order: apply this before the frontend and before calculate-elo; both
-- read season_award_voters when recomputing achievements.

-- ============================================================
-- 1. Who voted
-- ============================================================
-- One row per (season, player): the voter's linked player at their first
-- pick. Deliberately no award or nominee column.
CREATE TABLE IF NOT EXISTS season_award_voters (
  season_id      UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  player_id      UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  first_voted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_season_award_voters_player
  ON season_award_voters(player_id);

ALTER TABLE season_award_voters ENABLE ROW LEVEL SECURITY;

-- Public, like player_achievements, which publishes the same fact as a
-- Democracy! row; the browser recomputes (link changes, ending a season) read it.
DROP POLICY IF EXISTS "Anyone can read award voters" ON season_award_voters;
CREATE POLICY "Anyone can read award voters" ON season_award_voters
  FOR SELECT USING (true);

-- Written only by cast_award_vote.
REVOKE INSERT, UPDATE, DELETE ON season_award_voters FROM anon, authenticated;

-- ============================================================
-- 2. cast_award_vote: a pick also records the voter
-- ============================================================
-- #121's function (20260930_season_award_voting.sql), unchanged up to the
-- insert, plus the voter row and the achievement after it. A refused pick
-- raises before either, and a clear (NULL) returns before them.
CREATE OR REPLACE FUNCTION cast_award_vote(p_season_id UUID, p_award_id TEXT, p_nominee_player_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_awards CONSTANT TEXT[] := ARRAY[
    'award_offense', 'award_defense', 'award_fun', 'award_community',
    'award_improved', 'award_rookie'];
  v_voter     UUID := auth.uid();
  v_my_player UUID;
BEGIN
  -- COALESCE: get_my_role() is NULL for a logged-out caller, and NULL NOT IN
  -- (...) is NULL, which IF treats as false.
  IF COALESCE(get_my_role(), '') NOT IN ('user', 'admin') THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  SELECT player_id INTO v_my_player FROM player_accounts WHERE user_id = v_voter;
  IF v_my_player IS NULL THEN
    RAISE EXCEPTION 'voter_not_linked';
  END IF;
  IF p_award_id IS NULL OR NOT (p_award_id = ANY (c_awards)) THEN
    RAISE EXCEPTION 'unknown_award';
  END IF;
  -- Before the NULL branch: once voting closes a ballot is frozen, clears too.
  IF NOT COALESCE(award_voting_is_open(p_season_id), false) THEN
    RAISE EXCEPTION 'voting_not_open';
  END IF;

  IF p_nominee_player_id IS NULL THEN
    DELETE FROM season_award_votes
     WHERE season_id = p_season_id AND award_id = p_award_id AND voter_user_id = v_voter;
    RETURN;
  END IF;
  IF p_nominee_player_id = v_my_player THEN
    RAISE EXCEPTION 'self_vote';
  END IF;
  -- Live: the season may still be running. #122 re-checks at the close.
  IF NOT award_nominee_eligible(p_season_id, p_award_id, p_nominee_player_id) THEN
    RAISE EXCEPTION 'nominee_not_eligible';
  END IF;

  INSERT INTO season_award_votes (season_id, award_id, voter_user_id, nominee_player_id)
  VALUES (p_season_id, p_award_id, v_voter, p_nominee_player_id)
  ON CONFLICT (season_id, award_id, voter_user_id)
  DO UPDATE SET nominee_player_id = EXCLUDED.nominee_player_id, updated_at = now();

  -- Democracy!: the first pick of the season records the voter, and every
  -- later one finds the row already there, so its date never moves. The
  -- achievement takes that same date - the one the recompute derives - and
  -- the frontend recomputes after a first pick, so a meta it completes follows.
  INSERT INTO season_award_voters (season_id, player_id)
  VALUES (p_season_id, v_my_player)
  ON CONFLICT (season_id, player_id) DO NOTHING;
  INSERT INTO player_achievements (player_id, achievement_id, unlocked_at, season_id)
  SELECT player_id, 'democracy', first_voted_at, season_id
    FROM season_award_voters
   WHERE season_id = p_season_id AND player_id = v_my_player
  ON CONFLICT (player_id, achievement_id, season_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION cast_award_vote(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cast_award_vote(UUID, TEXT, UUID) TO authenticated;

-- ============================================================
-- 3. Backfill from the ballots still open
-- ============================================================
-- Only ballots not counted yet still exist; a counted season's voters are
-- gone with its ballots. updated_at is a pick's last change, so the earliest
-- one is as close to the first pick as the ballot still knows. Votes from an
-- account that has since been unlinked have no player to credit.
INSERT INTO season_award_voters (season_id, player_id, first_voted_at)
SELECT v.season_id, pa.player_id, min(v.updated_at)
  FROM season_award_votes v
  JOIN player_accounts pa ON pa.user_id = v.voter_user_id
 GROUP BY v.season_id, pa.player_id
ON CONFLICT (season_id, player_id) DO NOTHING;

INSERT INTO player_achievements (player_id, achievement_id, unlocked_at, season_id)
SELECT player_id, 'democracy', first_voted_at, season_id
  FROM season_award_voters
ON CONFLICT (player_id, achievement_id, season_id) DO NOTHING;
