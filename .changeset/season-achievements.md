---
"toegg-elo-frontend": minor
---

Season achievements: earn On the Board, a podium or top-ten finish and In the Green again every season - repeated ones show as ×N.

Adds `player_achievements.season_id` with a `NULLS NOT DISTINCT` unique key; apply `20260930_season_achievements.sql` before deploying calculate-elo and the frontend.
