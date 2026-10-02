---
"toegg-elo-frontend": minor
---

Season Awards voting: linked players vote for six awards, from a week before a season ends until two weeks into the next - secret ballot on shiny award and nominee cards, changeable until it closes, with live turnout.

Adds `seasons.planned_end_at`/`voting_opened_at`, the `season_award_votes` table and `seasons.voting_closes_at`, the `cast_award_vote`/`open_award_voting`/`close_award_voting`/`award_turnout` RPCs, and closes anon access to `end_season_and_start_new`. Apply `20260930_season_award_voting.sql` before deploying the frontend.
