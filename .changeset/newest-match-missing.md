---
"toegg-elo-frontend": patch
---

Fix the newest matches showing no rating changes in History and on the leaderboard.
Reads of `elo_history`, `matches`, `player_season_stats` and `player_achievements` now page through Supabase's 1000-row response cap (`fetchAllRows`), which had silently dropped the newest rows. `calculate-elo` also checks every write and rolls back a half-recorded match instead of reporting success.
