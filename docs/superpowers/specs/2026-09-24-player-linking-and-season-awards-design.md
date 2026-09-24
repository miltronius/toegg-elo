# Player linking, goal & season achievements, season awards - design

Date: 2026-09-24. Status: approved in brainstorming, not yet planned.

Six tickets that build on each other:

| # | Ticket | Depends on |
|---|---|---|
| 1 | Link account to player (self-claim, admin unlink/reassign, "That's Me!" achievement, UI name protection, "you" highlight) | - |
| 1b | Server-side name protection (`rename_player` RPC, admin-only `UPDATE` on `players`) | 1 |
| 2 | Goal achievements (Flawless Victory / Fatality, career and pair goal tiers) | - |
| 3 | Season achievements (repeatable-per-season schema, Participated, Top N, Net positive) | - |
| 4a | Season awards - voting (planned season end, voting window, secret ballot) | 1, 3 |
| 4b | Season awards - results (finalisation, winners, award achievements, banner, rankings) | 4a |

2 and 3 do not technically need 1, but are built in this order.

## Cross-cutting rules

- **Every achievement is rebuildable from stored data.** Admin → Recompute (`recomputeAllAchievementsAdmin`) deletes every `player_achievements` row and rebuilds; anything not derivable from stored facts would be lost, anything derived from mutable state would be revoked. That applies to links (`player_accounts`), season standings (`player_season_stats`) and award winners (`season_award_results`). Where an RPC also inserts an achievement row directly (so it appears immediately, without waiting for the next match), the recompute must derive the identical row.
- **New achievement ids** go into both `frontend/src/lib/achievements.ts` and `supabase/functions/_shared/achievements.ts`, plus `achievementDefs.<id>` in `frontend/src/locales/{en,de}.json`.
- **Meta-achievements** (`achievement_hunter`, `completionist`, `completionist_30`) count **distinct achievement ids**, not rows - fixed in ticket 3, when repeatable rows first appear.

---

## 1 - Link account to player

### Data
- New table `player_accounts`: `player_id UUID PRIMARY KEY REFERENCES players ON DELETE CASCADE`, `user_id UUID NOT NULL UNIQUE REFERENCES profiles ON DELETE CASCADE`, `linked_at TIMESTAMPTZ NOT NULL DEFAULT now()`. One account ↔ one player. A separate table (not a `profiles` column) keeps the link out of the profile's own RLS and lets "is this player claimed" be exposed without exposing which account.
- No direct write policies; all writes via SECURITY DEFINER RPCs:
  - `claim_player(player_id)` - caller role `user`/`admin`; caller not already linked; player not already linked. Inserts the link and the `linked_account` achievement row.
  - `admin_link_player(user_id, player_id)` - admin only; same uniqueness rules; also inserts the achievement.
  - `unlink_player(player_id)` - admin only; deletes the link **and** that player's `linked_account` achievement (the per-match recompute never deletes, so it would otherwise survive until the next admin recompute). Reassign = unlink + link.
- Reads: `get_players()` gains `is_linked BOOLEAN` (no account data). AuthContext exposes `myPlayerId` (read own link). Admins can read all links (User Management).
- Viewers cannot claim: they only see anonymous names, and a viewer is an unconfirmed account that can do nothing.

### Achievement
`linked_account` - **That's Me!** 🪪 / *Das bin ich!* - "Link your account to your player". Derived in `recomputeAllAchievements` from `player_accounts`, `unlocked_at = linked_at`. Unlinking revokes it; relinking grants it again with the new `linked_at` (one row, never duplicated).

### UI
- **Claim:** PlayerDetail shows "This is me" on an unclaimed player to an unlinked `user`/`admin`. Confirm dialog: "You're claiming **Anna**. Only an admin can undo this." → Claim. Claimed players show a 🪪 marker.
- **Admin:** User Management gains a Player column per account - Link / Change / Unlink.
- **"You" highlight:** own Leaderboard row highlighted, "(you)" in PlayerAutocomplete, "My profile" header entry opening own PlayerDetail.
- **Name protection (UI only in this ticket):** rename controls (name and anonymous name) shown only to an admin, the linked owner, or any `user` when the player is unclaimed. Pure helper `canRenamePlayer(player, me)`.
- **Known gap until 1b:** the backend is unchanged, so any `user` can still rename any player - or set `current_elo` - through the API directly.

### Tests
Vitest: `canRenamePlayer`, claim dialog. Deno: `linked_account` derivation. Staging: claim twice, claim a claimed player, viewer claim refused, unlink revokes achievement.

## 1b - Server-side name protection

- `rename_player(player_id, name, anonymous_name)` SECURITY DEFINER, same rule as `canRenamePlayer`. `updatePlayerName`/`updatePlayerAnonymousName` call it.
- Drop `"Users and admins can update players"` **under that exact name**; add an admin-only `UPDATE` policy (`deleteMatch` is admin-only and keeps working). `createPlayer` (INSERT) and `calculate-elo` (service role) are unaffected.
- Afterwards compare `pg_policies` for `players` on staging and prod rather than trusting the migration files (see CLAUDE.md, Auth & Roles).

---

## 2 - Goal achievements

### Goal counting
Pure `teamGoals(match, side)` in `_shared/achievements.ts`, mirrored to the frontend:
- `games = NULL` (pre-series row, backfilled as 1-0): winning side 10, losing side 0.
- Per game: an entered goal count counts as entered; an empty side falls back to 10 if that side won the game, 0 if it lost. So an unscored 2-1 win is 20 goals, the loss 10.
- A player's goals in a match are their team's goals (shared with the partner).

### Achievements (one-time, `season_id` NULL)

| id | en / de | Rule |
|---|---|---|
| `flawless_victory` | Flawless Victory 🏅 / *Makelloser Sieg* | Win a game with **both** goal fields explicitly entered as 10:0 |
| `fatality` | Fatality ☠️ / *Fatality* | Lose a game with both fields explicitly entered as 0:10 |
| `goals_200` | Goal Getter ⚽ / *Torjäger* | 200 career team goals |
| `goals_1000` | Goal Machine 🏭 / *Tormaschine* | 1,000 career team goals |
| `goals_10000` | Ten Thousand Club 🌋 / *Zehntausender-Club* | 10,000 career team goals |
| `pair_goals_100` | Dynamic Duo 👯 / *Dynamisches Duo* | 100 goals with one partner |
| `pair_goals_500` | Well-Oiled Machine ⚙️ / *Eingespieltes Team* | 500 goals with one partner |
| `pair_goals_2000` | Two-Headed Monster 🐉 / *Zweiköpfiges Monster* | 2,000 goals with one partner |

- A winner-only game (no goals entered) never counts as 10:0 for the shutout achievements, even though its fallback counts 10:0 for goal totals; neither does a half-filled `10 : empty`.
- `unlocked_at` = the match that crossed the threshold. Pair tiers go to the **first** partnership to cross, `meta: { partner_id }`.

### Plumbing
`_shared/achievements.ts` has its own `Match` interface without `games`/`team_*_games` - add them, and make the edge function's match query select them. Confirm the frontend `getMatches()` returns `games`.

### Tests
Deno: `teamGoals` (NULL games, full scores, half-filled, winner-only), threshold crossing dates, pair attribution, explicit-10:0 rule.

---

## 3 - Season achievements

### Schema (reused by 4b)
- `player_achievements.season_id UUID NULL REFERENCES seasons`. NULL = one-time achievement (all existing ones).
- Replace the `(player_id, achievement_id)` unique constraint with `UNIQUE NULLS NOT DISTINCT (player_id, achievement_id, season_id)`; upserts use `onConflict: "player_id,achievement_id,season_id"`. Requires Postgres 15+ - verify on staging and prod first.

### Achievements (per season, `season_id` set)

| id | en / de | Rule | `unlocked_at` |
|---|---|---|---|
| `season_participated` | On the Board 📋 / *Mit von der Partie* | ≥3 games in the season; unlocks live | 3rd game |
| `season_top_1` | Season Champion 🏆 / *Saisonsieger* | final rank 1 | season `ended_at` |
| `season_top_2` | Runner-Up 🥈 / *Vizemeister* | final rank 2 | 〃 |
| `season_top_3` | Podium 🥉 / *Podest* | final rank 3 | 〃 |
| `season_top_5` | High Five 🖐️ / *High Five* | final rank ≤ 5 | 〃 |
| `season_top_10` | Top Ten 🔟 / *Top Ten* | final rank ≤ 10 | 〃 |
| `season_net_positive` | In the Green 💹 / *Im grünen Bereich* | ranked, final season Elo ≥ 1501 | 〃 |

### Placement rules
- Ended seasons only; source is stored `player_season_stats` (`current_season_elo`, wins + losses).
- Ranked = ≥ 3 games in the season (`RANKED_MIN_GAMES`). Rank among ranked players by final season Elo; ties share a rank (1, 2, 2, 4).
- Placements are awarded only if the season had **≥ 5 ranked players**; Top N additionally needs **more than N** ranked players (Top 10 needs 11+).
- Only the **best** tier is awarded (the champion gets Top 1 only).
- Net positive and Participated are unaffected by the floor.

### Timing
Ending a season does not go through `calculate-elo`, so SeasonDialog runs the non-destructive `recomputeAllAchievements` right after `end_season_and_start_new`.

### Display
Achievement lists group by id with **×N** and the seasons in the tooltip. Rarity = % of players holding it at least once. Meta-achievements count distinct ids.

### Tests
Deno: ranking with ties, ≥ 5 floor and "> N" rule, best-tier-only, net positive at 1500 vs 1501, Participated in an active season, distinct-id meta count.

---

## 4a - Season awards: voting

### Seasons
Add `planned_end_at TIMESTAMPTZ NULL` (set in SeasonDialog, editable on the active season) and `voting_opened_at TIMESTAMPTZ NULL` (admin "Open voting now").

### Voting window for season S
- **Opens** at the earliest of `voting_opened_at`, `planned_end_at − 7 days`, S's `ended_at` (fallback so every season gets a vote).
- **Closes** at next season's `started_at + 14 days`.
- Pure `awardVotingStatus(season, nextSeason, now)` → `not_open | open | closed | finalized` in new `frontend/src/lib/seasonAwards.ts` (same pattern as `banners.ts`). `AWARD_VOTING_LEAD_DAYS = 7`, `AWARD_VOTING_TAIL_DAYS = 14` mirror the SQL, which enforces the same window.

### Awards (fixed in code, translated)

| id | en | de | Nominees |
|---|---|---|---|
| `award_offense` | Best Offensive Player ⚔️ | Bester Stürmer | ranked |
| `award_defense` | Best Defender 🛡️ - *The Wall* | Bester Verteidiger - *Die Wand* | ranked |
| `award_fun` | Most Fun to Play With 🎉 | Grösster Spassfaktor | ranked |
| `award_community` | Community Award 🤝 | Community-Preis | ranked |
| `award_improved` | Most Improved 🚀 | Grösster Fortschritt | ranked |
| `award_rookie` | Rookie of the Season 🌱 | Rookie der Saison | ranked in S, never ranked in an earlier season |
| `award_guest` | Special Guest 🎟️ | Stargast | played 1-2 games in S (not ranked) |

### Votes
- Table `season_award_votes`: `season_id`, `award_id` (CHECK in the list), `voter_user_id`, `nominee_player_id`, `updated_at`; UNIQUE `(season_id, award_id, voter_user_id)`.
- RLS: a voter reads only their own rows; nobody else reads any vote - **admins included**. No direct writes.
- `cast_award_vote(season_id, award_id, nominee_player_id | null)` SECURITY DEFINER: caller is a linked `user`/`admin`; window open; nominee eligible for that award; nominee ≠ caller's player. `null` clears the pick. Ballots are changeable until close; skipping awards is allowed.
- Eligibility is live (the season is still running during the first voting week); votes are re-checked at finalisation and ineligible ones dropped. The ballot says so.

### UI
- Ballot dialog (`.modal-panel`, so Win95 styling is automatic): one PlayerAutocomplete per award, limited to eligible nominees, own player excluded.
- Opened from a "🗳️ Vote for the Season Awards" nudge in Timeline and Season Stats while open ("x/7 picked · closes dd.mm.yyyy").
- Unlinked users see "Link your player to vote".
- No banner for "voting open" - that moment has no DB event to create one from.

### Tests
Vitest: `awardVotingStatus` (every open trigger, boundaries), eligibility helpers. Staging: window, self-vote, ineligible nominee, unlinked caller, viewer token.

## 4b - Season awards: results

### Finalisation
`finalize_season_awards(season_id)`, SECURITY DEFINER, idempotent - no-op unless the window has closed (checked in SQL) and the season is not yet finalised. Any signed-in client whose `awardVotingStatus` is `closed` calls it on load (lazy finalisation; no pg_cron). One transaction:
1. Drop votes for nominees no longer eligible; tally per award.
2. Write `season_award_results` (`season_id`, `award_id`, `player_id`, `votes`, `is_winner`) for every nominee with ≥ 1 vote. Winner = most votes; ties share the win; an award with < 3 votes cast has no winner.
3. Insert the `award_*` achievement rows (`season_id` set, `unlocked_at = awards_finalized_at`). `recomputeAllAchievements` derives the same rows from `season_award_results`.
4. Set `seasons.awards_finalized_at`.
5. Delete the season's ballots - the results table is all anything needs afterwards.
6. Insert the results banner.

### Banner
- `banners.award_season_id` (UNIQUE, same idempotency trick as `season_id`); `message` NULL = render translated default, e.g. "🏆 Season 5 Awards: ⚔️ Anna · 🛡️ Ben & Carla · …".
- Rendered **client-side from the player list**, so logged-out visitors get anonymous names - real names never reach a viewer. Extends `bannerDisplayText` / `storedMessage`. 14-day window, admin-editable like any banner.

### Season Stats
Season Awards section for the selected season: finalised → every award with the full nominee ranking by votes, winners highlighted, "Not awarded (fewer than 3 votes)" where applicable; open → vote nudge and deadline. `season_award_results` readable by everyone; names via `get_players()`.

### Achievements
Each `award_*` id is also a per-season achievement (×N), same icon and name as the award.

### Tests
Deno: award achievement derivation from results. Vitest: banner text (including anonymous-name path), rankings section. Staging: finalise early (refused), twice (no-op), tie, < 3 votes, ineligible vote dropped, ballots deleted.

## Out of scope
- Prefilling Record Match with the linked player (possible follow-up).
- Admin-configurable award categories (fixed in code by design).
- pg_cron.
