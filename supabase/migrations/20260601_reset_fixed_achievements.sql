-- Clear the achievement rows whose unlock logic changed, so they get
-- recomputed correctly on the next match (recomputeAllAchievements upserts with
-- ignoreDuplicates and never deletes, so stale rows must be removed here).
--
-- Logic changes:
--   * teams_1 / teams_3 / teams_10 — a partner now only counts once you've
--     paired up with them at least twice (a single shared match is not a team).
--   * carrying_hard / deadweight — the 200+ partner gap is now measured on
--     season ELO (normalized to 1500 at each season start), not all-time ELO.
--
-- Until the next recorded match repopulates these rows, the frontend falls back
-- to live client-side computation, so the UI keeps showing correct values.

DELETE FROM player_achievements
WHERE achievement_id IN (
  'teams_1',
  'teams_3',
  'teams_10',
  'carrying_hard',
  'deadweight'
);
