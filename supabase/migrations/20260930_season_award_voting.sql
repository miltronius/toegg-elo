-- Season Awards voting (#121). Linked players vote on six fixed awards from a
-- week before a season's planned end until two weeks into the next season; the
-- tally, winners and banner are #122.
--
-- Adds the season's planned end and the admin's "Open voting now", the secret
-- ballot table, and the RPCs that are the only way to write it. The window and
-- the eligibility rules are mirrored in frontend/src/lib/seasonAwards.ts -
-- change both together.
--
-- Safe to re-run: these are applied by hand in the SQL editor.
--
-- Release order: apply this before the frontend. The new SeasonDialog passes
-- end_season_and_start_new a fifth argument; the old frontend keeps working,
-- since that argument defaults to NULL.

-- ============================================================
-- 1. Seasons: planned end + early opening
-- ============================================================
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS planned_end_at   TIMESTAMPTZ;
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS voting_opened_at TIMESTAMPTZ;
-- The admin's closing date. NULL = the default, 14 days into the next season;
-- set, it replaces that default either way (earlier or later). "Close voting
-- now" sets it to now(); a later date reopens, until #122 finalises.
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS voting_closes_at TIMESTAMPTZ;

ALTER TABLE seasons DROP CONSTRAINT IF EXISTS seasons_planned_end_after_start;
ALTER TABLE seasons ADD CONSTRAINT seasons_planned_end_after_start
  CHECK (planned_end_at IS NULL OR planned_end_at > started_at);
ALTER TABLE seasons DROP CONSTRAINT IF EXISTS seasons_voting_closes_after_start;
ALTER TABLE seasons ADD CONSTRAINT seasons_voting_closes_after_start
  CHECK (voting_closes_at IS NULL OR voting_closes_at > started_at);

-- ============================================================
-- 2. end_season_and_start_new takes the new season's planned end
-- ============================================================
-- Dropped rather than replaced: adding a parameter would create an overload and
-- leave the 4-argument version callable.
--
-- The admin check changes too. The old `IF get_my_role() <> 'admin'` let a
-- logged-out caller through: get_my_role() is NULL for them, `NULL <> 'admin'`
-- is NULL, and IF treats NULL as false - while anon held EXECUTE through
-- Supabase's default privileges. So the anon key in the bundle could end the
-- season.
DROP FUNCTION IF EXISTS end_season_and_start_new(TEXT, INTEGER, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION end_season_and_start_new(
  new_season_name     TEXT,
  new_k_factor        INTEGER,
  new_penalty_percent NUMERIC,
  new_partner_weight  NUMERIC DEFAULT 0.25,
  new_planned_end_at  TIMESTAMPTZ DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_id     UUID;
  v_old_number INTEGER;
  v_new_id     UUID;
BEGIN
  IF COALESCE(get_my_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can end seasons';
  END IF;

  SELECT id, number INTO v_old_id, v_old_number FROM seasons WHERE is_active = true;
  IF v_old_id IS NULL THEN
    RAISE EXCEPTION 'No active season found';
  END IF;

  UPDATE seasons SET is_active = false, ended_at = NOW() WHERE id = v_old_id;

  -- A planned end at or before NOW() fails seasons_planned_end_after_start.
  INSERT INTO seasons (number, name, k_factor, inactivity_penalty_percent,
                       partner_weight, planned_end_at, started_at, is_active)
  VALUES (v_old_number + 1, new_season_name, new_k_factor, new_penalty_percent,
          new_partner_weight, new_planned_end_at, NOW(), true)
  RETURNING id INTO v_new_id;

  -- All-time stats (players.current_elo, wins, losses) are NOT touched.
  -- Season starts normalized at 1500; elo_at_start records where each player actually was.
  INSERT INTO player_season_stats
    (player_id, season_id, elo_at_start, current_season_elo, wins, losses)
  SELECT id, v_new_id, current_elo, 1500, 0, 0 FROM players;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION end_season_and_start_new(TEXT, INTEGER, NUMERIC, NUMERIC, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION end_season_and_start_new(TEXT, INTEGER, NUMERIC, NUMERIC, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- 3. "Open voting now"
-- ============================================================
-- An RPC rather than a client-side UPDATE so the moment is server time: the
-- window cast_award_vote enforces is measured against now() here too.
CREATE OR REPLACE FUNCTION open_award_voting(p_season_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(get_my_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  -- Only the running season: an ended one opened when it ended. COALESCE keeps
  -- the first opening, so a second click changes nothing.
  UPDATE seasons SET voting_opened_at = COALESCE(voting_opened_at, now())
   WHERE id = p_season_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'season_not_active';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION open_award_voting(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION open_award_voting(UUID) TO authenticated;

-- "Close voting now": any season whose ballot is open (usually the previous
-- one, during the first two weeks of the next). Server time, like opening.
-- Not one-way: the admin can set a later voting_closes_at to reopen.
-- Defined before award_voting_is_open below; plpgsql resolves it at call time.
CREATE OR REPLACE FUNCTION close_award_voting(p_season_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(get_my_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF NOT COALESCE(award_voting_is_open(p_season_id), false) THEN
    RAISE EXCEPTION 'voting_not_open';
  END IF;
  UPDATE seasons SET voting_closes_at = now() WHERE id = p_season_id;
END;
$$;

REVOKE ALL ON FUNCTION close_award_voting(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION close_award_voting(UUID) TO authenticated;

-- ============================================================
-- 4. The window and who may be nominated (internal; #122 reuses both)
-- ============================================================
-- Mirrors awardVotingStatus in lib/seasonAwards.ts: open from the earliest of
-- "Open voting now", 7 days before the planned end, and the actual end, until
-- the admin's closing date or else 14 days into the next season. LEAST ignores
-- NULLs; nothing set at all is not open, and no close at all never closes. Fixed hours, not days: the TS works in milliseconds, and an INTERVAL
-- in days would follow DST in the session time zone.
CREATE OR REPLACE FUNCTION award_voting_is_open(p_season_id UUID)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
           now() >= LEAST(s.voting_opened_at,
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

-- Mirrors eligibleNomineeIds in lib/seasonAwards.ts. Games are series from
-- player_season_stats, the count the Leaderboard's ranked badge uses;
-- 3 = RANKED_MIN_GAMES. Only called with an award id already checked.
CREATE OR REPLACE FUNCTION award_nominee_eligible(p_season_id UUID, p_award_id TEXT, p_player_id UUID)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH g AS (
    SELECT COALESCE((SELECT wins + losses FROM player_season_stats
                      WHERE player_id = p_player_id AND season_id = p_season_id), 0) AS n
  )
  SELECT CASE
           WHEN p_award_id = 'award_rookie' THEN g.n >= 3 AND NOT EXISTS (
             SELECT 1
               FROM player_season_stats pss
               JOIN seasons earlier ON earlier.id = pss.season_id
              WHERE pss.player_id = p_player_id
                AND pss.wins + pss.losses >= 3
                AND earlier.number < (SELECT number FROM seasons WHERE id = p_season_id))
           ELSE g.n >= 3
         END
    FROM g;
$$;

-- Supabase's default privileges grant EXECUTE on new public functions to
-- anon/authenticated; these are only for the SECURITY DEFINER callers.
REVOKE ALL ON FUNCTION award_voting_is_open(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION award_nominee_eligible(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 5. The secret ballot
-- ============================================================
CREATE TABLE IF NOT EXISTS season_award_votes (
  season_id         UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  award_id          TEXT NOT NULL,
  voter_user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  nominee_player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, award_id, voter_user_id)
);

-- SEASON_AWARDS in lib/seasonAwards.ts; cast_award_vote repeats the list.
-- A named constraint, re-added on every run, so a re-run picks up a changed
-- list (CREATE TABLE IF NOT EXISTS would keep the old one). The DELETE clears
-- votes for an award that was dropped from the list - on staging, the
-- "Special Guest" award that was withdrawn before release.
ALTER TABLE season_award_votes DROP CONSTRAINT IF EXISTS season_award_votes_award_id_check;
DELETE FROM season_award_votes WHERE award_id NOT IN (
  'award_offense', 'award_defense', 'award_fun', 'award_community',
  'award_improved', 'award_rookie');
ALTER TABLE season_award_votes ADD CONSTRAINT season_award_votes_award_id_check
  CHECK (award_id IN (
    'award_offense', 'award_defense', 'award_fun', 'award_community',
    'award_improved', 'award_rookie'));

CREATE INDEX IF NOT EXISTS idx_season_award_votes_voter
  ON season_award_votes(voter_user_id);
CREATE INDEX IF NOT EXISTS idx_season_award_votes_nominee
  ON season_award_votes(nominee_player_id);

ALTER TABLE season_award_votes ENABLE ROW LEVEL SECURITY;

-- Your own ballot only. Deliberately no admin clause: nobody reads anyone
-- else's votes, admins included. #122 tallies them inside a SECURITY DEFINER
-- function.
DROP POLICY IF EXISTS "Voters read their own ballot" ON season_award_votes;
CREATE POLICY "Voters read their own ballot" ON season_award_votes
  FOR SELECT USING (voter_user_id = (SELECT auth.uid()));

-- No write policies, and no write grants either: cast_award_vote is the only
-- way in. Not added to the realtime publication.
REVOKE INSERT, UPDATE, DELETE ON season_award_votes FROM anon, authenticated;

-- ============================================================
-- 6. cast_award_vote
-- ============================================================
-- One pick per (season, award, voter); NULL clears it. Refuses with a bare code
-- the frontend translates (lib/seasonAwards.ts AWARD_ERROR_CODES).
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
END;
$$;

REVOKE ALL ON FUNCTION cast_award_vote(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cast_award_vote(UUID, TEXT, UUID) TO authenticated;

-- ============================================================
-- 7. Turnout
-- ============================================================
-- How many have voted, overall and per award - never for whom. The ballot and
-- the vote nudge show it while voting is open; the per-nominee tally waits for
-- the close (#122), since live standings in a league this small would let a
-- watcher work out individual ballots by diffing, and invite tactical
-- switching while picks are still changeable.
--
-- `eligible` is the linked user/admin accounts right now, i.e. who could vote.
-- A demoted voter's votes still count in `voters`, so the UI clamps.
CREATE OR REPLACE FUNCTION award_turnout(p_season_id UUID)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(get_my_role(), '') NOT IN ('user', 'admin') THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  RETURN jsonb_build_object(
    'voters', (SELECT count(DISTINCT voter_user_id) FROM season_award_votes
                WHERE season_id = p_season_id),
    'eligible', (SELECT count(*) FROM player_accounts pa
                   JOIN profiles pr ON pr.id = pa.user_id
                  WHERE pr.role IN ('user', 'admin')),
    'awards', COALESCE((SELECT jsonb_object_agg(award_id, n)
                          FROM (SELECT award_id, count(*) AS n FROM season_award_votes
                                 WHERE season_id = p_season_id GROUP BY award_id) t),
                       '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION award_turnout(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION award_turnout(UUID) TO authenticated;
