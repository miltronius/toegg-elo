-- Season Awards results (#122). Voting (#121, 20260930_season_award_voting.sql)
-- stops by itself at the closing date; counting is a deliberate admin step:
-- "Close voting and count" while a ballot is open, "Count votes" once it has
-- closed. Until then a closed ballot can still be reopened by moving the
-- closing date, which is why nothing counts automatically.
--
-- Counting tallies the votes into season_award_results (readable by everyone),
-- gives the winners their award achievements, stamps the season final, deletes
-- the individual ballots and adds the results banner - in one transaction.
--
-- Safe to re-run: these are applied by hand in the SQL editor.
--
-- Release order: apply this before the frontend and before calculate-elo; both
-- read season_award_results (calculate-elo for the award achievements).

-- ============================================================
-- 1. Seasons: when the results became final
-- ============================================================
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS awards_finalized_at TIMESTAMPTZ;

-- A counted season's voting is over for good: its ballots are gone, so moving
-- the closing date later must not reopen it. Replaces #121's version, which
-- only looked at the window.
CREATE OR REPLACE FUNCTION award_voting_is_open(p_season_id UUID)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
           s.awards_finalized_at IS NULL
           AND now() >= LEAST(s.voting_opened_at,
                              s.planned_end_at - INTERVAL '168 hours',  -- AWARD_VOTING_LEAD_DAYS
                              s.ended_at)
           AND now() < COALESCE(s.voting_closes_at,
                                nx.started_at + INTERVAL '336 hours',  -- AWARD_VOTING_TAIL_DAYS
                                'infinity'::timestamptz),
           false)
    FROM seasons s
    LEFT JOIN seasons nx ON nx.number = s.number + 1
   WHERE s.id = p_season_id;
$$;
REVOKE ALL ON FUNCTION award_voting_is_open(UUID) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 2. The results
-- ============================================================
-- One row per nominee who got at least one counted vote. Winners: the most
-- votes in the award; a tie shares the win; an award with fewer than 3 votes
-- cast (AWARD_MIN_VOTES in lib/seasonAwards.ts) has no winner.
CREATE TABLE IF NOT EXISTS season_award_results (
  season_id  UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  award_id   TEXT NOT NULL,
  player_id  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  votes      INTEGER NOT NULL CHECK (votes > 0),
  is_winner  BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (season_id, award_id, player_id)
);

-- SEASON_AWARDS in lib/seasonAwards.ts, as on season_award_votes.
ALTER TABLE season_award_results DROP CONSTRAINT IF EXISTS season_award_results_award_id_check;
ALTER TABLE season_award_results ADD CONSTRAINT season_award_results_award_id_check
  CHECK (award_id IN (
    'award_offense', 'award_defense', 'award_fun', 'award_community',
    'award_improved', 'award_rookie'));

CREATE INDEX IF NOT EXISTS idx_season_award_results_player
  ON season_award_results(player_id);

ALTER TABLE season_award_results ENABLE ROW LEVEL SECURITY;

-- Public, logged-out visitors included: the counts say nothing about who voted
-- for whom, and names reach the client through get_players(), which already
-- swaps in the anonymous name for anyone who isn't a user or admin.
DROP POLICY IF EXISTS "Anyone can read award results" ON season_award_results;
CREATE POLICY "Anyone can read award results" ON season_award_results
  FOR SELECT USING (true);

-- Written only by finalize_season_awards.
REVOKE INSERT, UPDATE, DELETE ON season_award_results FROM anon, authenticated;

-- ============================================================
-- 3. The results banner
-- ============================================================
-- Set on the banner a count created. Like a season banner, its message starts
-- NULL meaning "render the translated default" - built client-side from the
-- results and the player list, so each viewer gets their own language and the
-- names they're allowed to see.
ALTER TABLE banners ADD COLUMN IF NOT EXISTS award_season_id UUID
  REFERENCES seasons(id) ON DELETE CASCADE;
-- One per season, which also makes the insert below idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_banners_one_award_banner_per_season
  ON banners (award_season_id) WHERE award_season_id IS NOT NULL;

ALTER TABLE banners DROP CONSTRAINT IF EXISTS banner_message_present;
ALTER TABLE banners ADD CONSTRAINT banner_message_present CHECK (
  (message IS NULL AND (season_id IS NOT NULL OR award_season_id IS NOT NULL))
  OR (message IS NOT NULL AND char_length(btrim(message)) BETWEEN 1 AND 500)
);

-- ============================================================
-- 4. Counting
-- ============================================================
CREATE OR REPLACE FUNCTION finalize_season_awards(p_season_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_min_votes CONSTANT INTEGER := 3;  -- AWARD_MIN_VOTES
  v_season    seasons%ROWTYPE;
  v_now       TIMESTAMPTZ := now();
BEGIN
  IF COALESCE(get_my_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  -- Locked, so two admins counting at once can't both tally: the second waits,
  -- then finds the stamp and does nothing.
  SELECT * INTO v_season FROM seasons WHERE id = p_season_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'season_not_found';
  END IF;
  IF v_season.awards_finalized_at IS NOT NULL THEN
    RETURN;
  END IF;

  -- Nothing to count before voting has even opened (same opening rule as
  -- award_voting_is_open).
  IF NOT COALESCE(v_now >= LEAST(v_season.voting_opened_at,
                                 v_season.planned_end_at - INTERVAL '168 hours',
                                 v_season.ended_at), false) THEN
    RAISE EXCEPTION 'voting_not_open';
  END IF;

  -- "Close voting and count": a ballot that's still open closes now.
  IF award_voting_is_open(p_season_id) THEN
    UPDATE seasons SET voting_closes_at = v_now WHERE id = p_season_id;
  END IF;

  -- 1. Votes for someone who no longer qualifies don't count. Checked now, at
  --    the close, since a running season's eligibility changes as it's played.
  DELETE FROM season_award_votes v
   WHERE v.season_id = p_season_id
     AND NOT award_nominee_eligible(p_season_id, v.award_id, v.nominee_player_id);

  -- 2. The tally, then the winners.
  INSERT INTO season_award_results (season_id, award_id, player_id, votes)
  SELECT p_season_id, award_id, nominee_player_id, count(*)
    FROM season_award_votes
   WHERE season_id = p_season_id
   GROUP BY award_id, nominee_player_id
  ON CONFLICT (season_id, award_id, player_id) DO UPDATE SET votes = EXCLUDED.votes;

  UPDATE season_award_results r
     SET is_winner = (
           r.votes = (SELECT max(x.votes) FROM season_award_results x
                       WHERE x.season_id = r.season_id AND x.award_id = r.award_id)
           AND (SELECT sum(x.votes) FROM season_award_results x
                 WHERE x.season_id = r.season_id AND x.award_id = r.award_id) >= c_min_votes)
   WHERE r.season_id = p_season_id;

  -- 3. Each win is a per-season achievement with the award's id. The frontend
  --    recomputes right after, so the meta-achievements count it too, and the
  --    recompute derives these same rows from season_award_results.
  INSERT INTO player_achievements (player_id, achievement_id, unlocked_at, season_id)
  SELECT player_id, award_id, v_now, p_season_id
    FROM season_award_results
   WHERE season_id = p_season_id AND is_winner
  ON CONFLICT (player_id, achievement_id, season_id) DO NOTHING;

  -- 4. Final.
  UPDATE seasons SET awards_finalized_at = v_now WHERE id = p_season_id;

  -- 5. The ballots have served their purpose; the results are all anything
  --    needs from here on, and a secret ballot is best not kept.
  DELETE FROM season_award_votes WHERE season_id = p_season_id;

  -- 6. Announce it for two weeks (RESULTS_BANNER_DAYS in lib/banners.ts).
  INSERT INTO banners (message, award_season_id, starts_at, ends_at, is_active, audience)
  VALUES (NULL, p_season_id, v_now, v_now + INTERVAL '14 days', true, 'everyone')
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION finalize_season_awards(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finalize_season_awards(UUID) TO authenticated;
