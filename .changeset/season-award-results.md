---
"toegg-elo-frontend": minor
---

Season Awards results: an admin counts the votes once voting has closed, the winners get the award as an achievement, and the results appear in Season Stats and in a banner.

Adds `season_award_results`, `seasons.awards_finalized_at`, `banners.award_season_id` and the admin-only `finalize_season_awards` RPC (closes a still-open ballot, drops votes for nominees who no longer qualify, tallies, records winners, deletes the ballots). Award wins are per-season achievements in both copies of the achievements code. Apply `20261002_season_award_results.sql` before deploying the frontend and `calculate-elo`.
