# toegg-elo-frontend

## 1.10.0 (2026-09-27)

### Minor Changes

- [#127](https://github.com/miltronius/toegg-elo/pull/127) - What's new: click the version number next to the title to see every release, and release announcements in the banner link here

  Versioning with changesets: each PR adds a changeset, a "Release: version packages" PR collects them, and merging it tags the release with a GitHub Release.

- [#125](https://github.com/miltronius/toegg-elo/pull/125) - Goal achievements: Flawless Victory, Fatality, and tiers for goals scored - alone and with a partner

  Empty goal fields count 10 for the game's winner and 0 for its loser; the shutouts need both scores typed in.

- [#124](https://github.com/miltronius/toegg-elo/pull/124) - 🏅 Ranked badge: players with 3+ games in a season are marked on the leaderboard, which can now show all, played or ranked players

## 1.9.0 (2026-09-16)

### Minor Changes

- [#111](https://github.com/miltronius/toegg-elo/pull/111) - A series is now rated on its margin: winning 2:1 counts like a 1:0, so winning a series never costs you rating

  Replaces summing per-game results. Season 4 was re-rated under the new model.

- [#116](https://github.com/miltronius/toegg-elo/pull/116) - Easter egg: grab the announcement banner and scratch it like a record 🎧

### Patch Changes

- [#114](https://github.com/miltronius/toegg-elo/pull/114) - Fixed the order of the team rankings
- [#112](https://github.com/miltronius/toegg-elo/pull/112) - Only players and admins can record matches

  The calculate-elo function now checks the caller's role itself; also closed database policies that let anonymous callers delete data.

## 1.8.0 (2026-08-03)

### Minor Changes

- [#109](https://github.com/miltronius/toegg-elo/pull/109) - Record a whole series (e.g. 2:1) instead of a single result, with optional goal scores per game

  Also introduces partner weighting: your partner's rating now counts towards your expected result (default 0.25, set per season).

- [#105](https://github.com/miltronius/toegg-elo/pull/105) - Scrolling announcement banner, a new-season announcement, and a type-to-search player picker
- [#105](https://github.com/miltronius/toegg-elo/pull/105) - Better leaderboard filters

### Patch Changes

- [#108](https://github.com/miltronius/toegg-elo/pull/108) - Fixed the achievements layout in the Win95 theme

## 1.7.0 (2026-07-16)

### Minor Changes

- [#102](https://github.com/miltronius/toegg-elo/pull/102) - Relationships: a network of who plays with and against whom, in 2D or 3D

## 1.6.0 (2026-06-28)

### Minor Changes

- [#97](https://github.com/miltronius/toegg-elo/pull/97) - See each team's chance of winning while entering a match
- [#99](https://github.com/miltronius/toegg-elo/pull/99) - Season stats: game days

## 1.5.0 (2026-06-08)

### Minor Changes

- [#94](https://github.com/miltronius/toegg-elo/pull/94) - The app is now available in German 🇨🇭

## 1.4.0 (2026-06-04)

### Minor Changes

- [#92](https://github.com/miltronius/toegg-elo/pull/92) - Live updates: the dashboard refreshes when someone else records a match, plus faster loading and 2 new achievements
- [#82](https://github.com/miltronius/toegg-elo/pull/82) - Season stats: headline numbers for each season
- [#87](https://github.com/miltronius/toegg-elo/pull/87) - Lose streaks, and more season statistics
- [#89](https://github.com/miltronius/toegg-elo/pull/89) - A daily activity heatmap for the season

### Patch Changes

- [#82](https://github.com/miltronius/toegg-elo/pull/82) - Fixed achievements that were unlocked wrongly

## 1.3.0 (2026-05-30)

### Minor Changes

- [#70](https://github.com/miltronius/toegg-elo/pull/70) - Win streaks 🔥
- [#77](https://github.com/miltronius/toegg-elo/pull/77) - Player stats by weekday, and better graphs
- [#78](https://github.com/miltronius/toegg-elo/pull/78) - Anonymous names: logged-out visitors see a musician's name instead of the real one
- [#79](https://github.com/miltronius/toegg-elo/pull/79) - A new wave of achievements

### Patch Changes

- [#71](https://github.com/miltronius/toegg-elo/pull/71) - Fixed the leaderboard sorting, and the timeline ranking to match
- [#75](https://github.com/miltronius/toegg-elo/pull/75) - Players added later no longer show up in older seasons

## 1.2.0 (2026-04-27)

### Minor Changes

- [#61](https://github.com/miltronius/toegg-elo/pull/61) - Themes: light, dark and Windows 95 ☀️🌙🪟
- [#59](https://github.com/miltronius/toegg-elo/pull/59) - Seasons are highlighted in the all-time Elo graph, and the timeline shows ranking changes better

### Patch Changes

- [#59](https://github.com/miltronius/toegg-elo/pull/59) - Several Elo bugfixes

## 1.1.0 (2026-04-07)

### Minor Changes

- [#54](https://github.com/miltronius/toegg-elo/pull/54) - Achievement overview: see every achievement and who has unlocked it

### Patch Changes

- [#53](https://github.com/miltronius/toegg-elo/pull/53) - Fixed the Elo chart for seasons
- [#48](https://github.com/miltronius/toegg-elo/pull/48) - Admins can delete again, and achievement dates are correct

## 1.0.0 (2026-04-04)

### Minor Changes

- [#43](https://github.com/miltronius/toegg-elo/pull/43) - Seasons: everyone starts each season at 1500 Elo
- [#40](https://github.com/miltronius/toegg-elo/pull/40) - Achievements 🏆
- [#41](https://github.com/miltronius/toegg-elo/pull/41) - More achievements

## 0.6.0 (2026-04-01)

### Minor Changes

- [#36](https://github.com/miltronius/toegg-elo/pull/36) - Top friends and enemies on each player's page

## 0.5.0 (2026-03-22)

### Minor Changes

- [#27](https://github.com/miltronius/toegg-elo/pull/27) - Teams: stats for every pair that has played together, with optional team names and colours

## 0.4.0 (2026-03-20)

### Minor Changes

- [#16](https://github.com/miltronius/toegg-elo/pull/16) - One Elo chart with every player on it
- [#18](https://github.com/miltronius/toegg-elo/pull/18) - Player graphs per date or per game
- [#14](https://github.com/miltronius/toegg-elo/pull/14) - Rainbow colours for the ranking chart
- [#23](https://github.com/miltronius/toegg-elo/pull/23) - Sign in with a magic link - no password needed
- [#20](https://github.com/miltronius/toegg-elo/pull/20) - A nicer login screen

### Patch Changes

- [#25](https://github.com/miltronius/toegg-elo/pull/25) - Delete buttons are hidden unless you're allowed to use them

## 0.3.0 (2026-03-11)

### Minor Changes

- [#12](https://github.com/miltronius/toegg-elo/pull/12) - Accounts and roles: viewers can look, players can record matches, admins manage everything

## 0.2.0 (2026-03-03)

### Minor Changes

- Ranking chart: see how the leaderboard positions changed over time
- The Elo graph marks the 1500 starting line

## 0.1.0 (2026-02-04)

### Minor Changes

- First version: record 2v2 matches, an Elo leaderboard, and match history with the calculation behind each result
