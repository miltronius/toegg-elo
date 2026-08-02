# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TöggELO (Töggeli Elo) - a dashboard to track 2v2 table soccer (foosball) matches and rank players using the Elo ranking system.

## Commands

### Frontend (run from `frontend/`)
```bash
pnpm dev        # Start dev server on port 5173
pnpm build      # Production build
pnpm lint       # ESLint on src/
pnpm test       # Vitest unit/component tests (run once)
pnpm test:watch # Vitest in watch mode
pnpm preview    # Preview production build
```

### Supabase Edge Function (run from `supabase/functions/calculate-elo/`)
```bash
deno lint       # Lint the function
deno test -A    # Run tests
```

### Pre-commit hook
Husky runs `pnpm lint && pnpm test` (frontend) and `deno lint && deno test -A` (edge function) on every commit.

### Environment Setup
Copy `frontend/.env.example` to `frontend/.env.local` and fill in:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Architecture

### Stack
- **Frontend:** React 19 + Vite + TypeScript, Recharts for Elo history charts, `d3-force-3d` for the relationship graph's 2D/3D layout math (rendering is our own SVG), `@react95/core` for Win95 theme chrome, `react-i18next` for translations
- **Backend:** Supabase (PostgreSQL + Auth + RLS)
- **Edge Function:** Deno (`supabase/functions/calculate-elo/`) for Elo computation
- **Package manager:** pnpm

### Frontend Structure
- `frontend/src/lib/supabase.ts` - all Supabase queries and mutations; single source of truth for data access
- `frontend/src/contexts/AuthContext.tsx` - wraps the app, exposes `useAuth()` with user, role, and auth methods
- `frontend/src/contexts/ThemeContext.tsx` - exposes `useTheme()` with `theme` (`"light" | "dark" | "win95"`) and `setTheme()`; persists selection in cookie `toegg-theme` (1-year); sets `data-theme` on `<html>` synchronously to avoid flash
- `frontend/src/lib/i18n.ts` - i18next init (imported once in `main.tsx`); components call `useTranslation()` for `t()`. English (`en`, fallback) + German (`de`), with strings in `frontend/src/locales/{en,de}.json`; language persisted in cookie `toegg-lang` via `i18next-browser-languagedetector` (detection order cookie → browser, `de-CH` normalized to `de`). Also exports `DATE_LOCALE` (`'de-CH'`) - the fixed locale every `toLocale*String` date/time call uses, so dates stay Swiss-formatted (dd.mm.yyyy) regardless of UI language. Achievement names/descriptions are translated at the display layer under the `achievementDefs.<id>` keys (the `ACHIEVEMENT_DEFINITIONS` in `achievements.ts` stay English as the shared backend source + fallback)
- `frontend/src/App.tsx` - main orchestrator; fetches all state in one TanStack Query (`fetchAppData`, key `["appData", userId, role]`) and refetches via `refresh()` (`invalidateQueries`), passes data + callbacks to children; manages `selectedSeason` shared across Leaderboard, Teams, and PlayerDetail
- `frontend/src/lib/teamUtils.ts` - pure team stat computation (`computeTeamStats`, `teamColor`, `teamKey`); no DB calls
- `frontend/src/lib/achievements.ts` - `ACHIEVEMENT_DEFINITIONS` array; shared between frontend and the `_shared` edge function
- `frontend/src/lib/rosterFilter.ts` - who counts as "part of the season": a player is **ranked** only at `RANKED_MIN_GAMES` (3) games in the season in scope. `filterRoster(players, "all" | "played" | "ranked")` drives the Leaderboard's roster toggle (table *and* both charts, since they all consume the same filtered list). The two narrowing views are gated on how much they'd actually show - `isFilterAvailable` offers one at `FILTER_MIN_ENTRIES` (1) player, `defaultRosterFilter` auto-selects the narrowest at `AUTO_SELECT_MIN_ENTRIES` (4 - a 2v2 match *is* 4 players, so the played view takes over from the very first recorded game), else falls back to `all`. So a view is never *entered* empty and never *defaults* to a board too thin to read. `resolveRosterFilter` drops a pinned choice that has no data in the current scope (e.g. switching to a season where nobody qualifies) rather than stranding the user on an empty board behind a disabled button. Callers pass season-scoped players (Leaderboard overrides `matches_played` with the season's wins+losses), so the same helper serves season and all-time views. No DB calls
- `frontend/src/lib/seasonStats.ts` - pure headline-stat computation (`computeSeasonStats`): games played, active players, longest win/lose streak, best/worst day, biggest win/loss, highest/lowest Elo (season-normalized for a season, raw all-time otherwise), busiest day, win-rate leader, achievements unlocked, games-by-weekday, per-day activity + date range; no DB calls
- `frontend/src/lib/relationshipGraph.ts` - pure league-wide relationship computation (`computeRelationshipGraph`): nodes = players who played, friend edges = games as teammates, foe edges = games as opponents. Foe records are directional on an undirected `lo:hi` key - always stored from `lo`'s side, with `loShare` (0..1) driving the tug-of-war split. `topEdgesPerPlayer` keeps each player's N strongest links and drops the rest; **an absolute "min games" threshold does not work here** - with ~12 players everyone eventually partners with and faces everyone, so the graph is complete (all C(n,2) pairs) at any realistic match volume. Filters edges only, never nodes. No DB calls. Overlaps `computeTeammateCounts`/`computeOpponentCounts` (`achievements.ts`) and the private `computeHeadToHead` (`PlayerDetail.tsx`) - those are per-player, this is league-wide; consolidating them is open work
- `frontend/src/lib/playerSearch.ts` - pure name-matching for the player picker. `sortPlayersByName` is locale-aware (`DATE_LOCALE`, `sensitivity: "base"`) so umlauts file with their base letter rather than after z; `normalizeForSearch` strips case and diacritics so typing "muller" finds "Müller"; `filterPlayers` returns prefix matches before substring ones, alphabetical within each tier. **Ordering is alphabetical, not by Elo** - the picker is for finding a name you already have in mind, and a list that reshuffles as ratings change has no stable place to look; rank belongs on the leaderboard. No DB calls
- `frontend/src/components/PlayerAutocomplete.tsx` - type-to-find combobox replacing the old `PlayerDropdown` (deleted). Used by MatchForm (4x, with `excludeIds` hiding players already picked) and the Teams player filter (via `emptyLabel` for its "All players" entry). Selection is always by id; the text box only finds it, so text matching nobody selects nobody and the field snaps back to the current selection on Escape/blur rather than leaving a half-typed name looking authoritative. Arrow keys wrap (`nextHighlight`), Enter takes the sole match when nothing is highlighted, Backspace on an empty box clears
- `frontend/src/lib/colors.ts` - palette constants mirroring the CSS vars, plus `hashHue`/`hslHex` (seed string → stable HSL → hex, used by `teamColor` in `teamUtils.ts`) and `RELGRAPH_SLOTS`. Note `Leaderboard.tsx` keeps its own file-private index-based `playerColor` for evenly-spaced bump-chart hues - deliberately different
- `frontend/src/components/RelationshipGraph.tsx` - force-directed player network. Uses `d3-force-3d` for layout math only (it covers both modes via `numDimensions(2|3)`); the SVG is rendered here, so colors stay CSS vars, all three themes work, and the tug-of-war edges keep working. `frontend/src/types/d3-force-3d.d.ts` hand-declares the package (it ships no types). Key invariants:
  - **3D must seed nodes on a sphere** (`seedPosition`): with every z at 0 the repulsion has no z-component and the layout stays flat forever. Switching 2D→3D re-seeds for the same reason
  - Friends|Foes swaps the link set on the *same* simulation so nodes hold position; dimension/data/canvas changes rebuild it
  - `chargeFor()` scales repulsion to the room per node - a fixed charge either knots up on a large canvas or flings nodes off a small one
  - `WARMUP_TICKS` runs the settle synchronously (`tick()` fires no events) so the graph arrives near-settled instead of animating hundreds of rendered frames
  - Projection is one path: 2D is the 3D projection with zero rotation and z = 0, which reduces to identity
  - Nodes are draggable (pointer capture → `fx`/`fy`/`fz` pinning → `alphaTarget(0.3)`); a press that never moves counts as a click. Background drag orbits in 3D, pans in 2D; wheel zooms (registered non-passively by hand, since React's synthetic wheel handler is passive)
  - **Node colour is not identity - the labels are.** No palette of ~12 perceptually distinct colours exists (measured with the dataviz skill's validator: past six, pairs fall under the ΔE 15 normal-vision floor; the old id-hash scheme scored 5.8, i.e. indistinguishable). So the six `--relgraph-c1..c6` vars are assigned by graph colouring (`assignColorSlots`) purely so linked players never match - which is what makes the two-tone foe edges readable. Clean at the default budget; the friend+foe union can force a repeat at budget 5+. Slot → hex lives in CSS, so themes still work without the component knowing the theme
  - Friend edges are **directed**: game counts are symmetric but preference isn't, so `loPicked`/`hiPicked`/`mutual` mark an unrequited favourite with an arrow (one `auto-start-reverse` marker serves both ends)
  - Scopes seasons locally and defaults to all-time, rather than using App's shared `selectedSeason` - so App passes it the **unfiltered** `allPlayerSeasonStats`
- `frontend/src/lib/banners.ts` - pure visibility logic for the scrolling message banner. **Every banner is a row in `banners`, the new-season announcement included** - a `create_season_banner` trigger inserts one whenever a season starts, so an admin can edit, reschedule, retarget or delete it like any other. Visibility is a window (`starts_at`/`ends_at`, either bound optional) gated by `is_active`; keeping the switch separate from the window is what lets an admin park a scheduled message without losing its dates. `bannerStatus` collapses that to `live | scheduled | expired | hidden` for the admin list's chips. Note the switch and the window are **independent controls, not a three-way choice** - an earlier version offered "show now / scheduled / hidden", which read as redundant because hiding and scheduling aren't alternatives: hiding is "never show this", scheduling is "show it between these times", and every combination of the two is meaningful. `audience` (`everyone | members`) splits logged-in from the public landing view - it is *not* a permission tier (every signed-in role sees `members`), and RLS enforces it server-side as well as `forAudience` client-side. A stored row can only hold one language, so a season banner's `message` starts NULL meaning "render the translated default" (`isGeneratedSeasonBanner`); an admin's text overrides it for everyone, and clearing the field reverts. `SEASON_BANNER_DAYS` (14) here is **descriptive only** - the real window is written on the row by the trigger, so it must be kept in sync with that INTERVAL. Every decision is a pure function of `(data, now)` because a window opening changes nothing in the DB, so no realtime event ever announces it. Also holds the marquee pacing constants; `MARQUEE_GAP_RATIO` **mirrors the `60vw` gap in App.css** - one cycle travels exactly one copy, so the two must agree or the scroll speed drifts. No DB calls
- `frontend/src/lib/bannerText.ts` - the one place banner rows meet translation, kept out of `banners.ts` so that stays plain-data only. `bannerDisplayText(banner, seasons, t)` resolves a generated season banner to the translated string and everything else to its stored message; returns `""` when a season banner outlives its season, and callers drop empties rather than render a blank slot between separators. `storedMessage(typed, banner, seasons, t)` is the inverse for the admin form: the form **prefills** a season banner's field with the generated text so it can be edited in place, which makes "saved untouched" indistinguishable from "deliberately retyped the same words" — so text matching the generated default (or blank) stores NULL and stays translated, and only genuinely different text becomes an override
- `frontend/src/components/MessageBanner.tsx` - the marquee itself, rendered for everyone (logged out included) under the header. Everything visible is folded into one strip of text rather than a stack or carousel, so extra messages cost no vertical space. Key invariants:
  - **The strip is repeated three times, not twice.** A cycle shifts the track left by exactly one copy, so the remaining `N-1` have to still cover the screen; at `N=2` that needs one copy to be wider than the viewport on its own, which a short announcement isn't - the right edge goes blank once per cycle. At `N=3` the two 60vw gaps clear it whatever the message length
  - The track is `inline-flex` so it is sized by content; that is what makes `translateX(-100%/3)` land exactly on one copy and hide the seam
  - Only the first copy is exposed to assistive tech; the rest are `aria-hidden`, so an announcement is read once
  - A 30s tick re-evaluates visibility, since a window opening or closing produces no realtime event to refetch on
  - `prefers-reduced-motion` drops to a single static, self-scrollable copy - moving text is a classic vestibular trigger
- `frontend/src/components/BannerAdmin.tsx` - admin-only banner management under the Admin tab. One form doubles as create and edit; the list shows every banner the admin can see (hidden and expired included - RLS widens the read for admins specifically so the list is complete). Banners arrive as a prop from App's single query rather than being fetched here, so the admin list and the live banner can never disagree. Audience and on/off are segmented toggles (`.lb-toggle`), and the window is always available since it is independent of the switch - no window at all means "from now until switched off". The window fields are **plain text in `dd.mm.yyyy hh:mm`, not `<input type="datetime-local">`**: a native picker renders in the *browser's* locale, which no attribute can override, so parsing it ourselves (`maskSwissDateTime` masks keystrokes, `parseSwissDateTime` reads them) is the only way to keep DATE_LOCALE's Swiss format everywhere. `parseSwissDateTime` returns `empty | invalid | ok` rather than a nullable - a typo must be reported, since silently reading `31.02.2026` as "no end date" would publish a banner that never stops. Rows are reorderable by drag or arrow keys on the grip; the new order is written by one `set_banner_order` RPC on drop. A season banner is editable like any other, with one difference: its message field may be left blank (the placeholder shows the live translated default), and blank saves as NULL — a revert, not an empty banner
- `frontend/src/components/ActivityHeatmap.tsx` - pure presentational GitHub-style contribution graph (weeks as columns, Mon→Sun rows, oldest left → most recent right) of per-day match counts; pads the window backwards to `minWeeks` (default 13 ≈ 3 months) and highlights the `firstDay` cell in purple; used by SeasonStats
- `frontend/src/components/` - tab-based UI: Timeline, Leaderboard, Teams, TeamDetail, RelationshipGraph, MatchForm, MatchHistory, PlayerDetail/Modal, SeasonStats, ActivityHeatmap, Achievements, UserManagement, SeasonDialog, ThemeToggle, LanguageSwitcher, Win95Shell
- `frontend/src/test/setup.ts` - Vitest setup (jest-dom matchers, ResizeObserver mock, i18n init so components render real strings in tests)

**Tab visibility rules:**

- Timeline: logged-in users only; shown as first tab when authenticated
- Teams and Relationships: logged-in users only (any role, including `viewer`)
- Record Match, Achievements: `user` or `admin` role only
- Admin (user management + achievement recompute + message banners): `admin` only
- Message banner: shown to everyone, including logged-out visitors; individual banners can be narrowed to signed-in users via their `audience`
- Leaderboard and History: always visible

### Data Flow
1. `App.tsx` fetches everything through one TanStack Query; mutations call `refresh()` to invalidate it
2. All DB interactions go through helper functions in `supabase.ts`
3. Match recording invokes the `calculate-elo` Deno edge function via `supabase.functions.invoke()`
4. Child components call parent-provided callbacks to trigger data refresh

### Auth & Roles
Three roles enforced at DB level via Row-Level Security (RLS):
- `viewer` - read-only (default on signup)
- `user` - can record matches and manage players
- `admin` - full control including deletes and user role management

A `handle_new_user()` trigger auto-creates a `viewer` profile in the `profiles` table on signup. Magic link (OTP) login is supported.

### Database Schema (key tables)
- `players` - name, current_elo (default 1500), matches_played, wins, losses
- `matches` - team_a/team_b player IDs (2v2), winning_team, season_id
- `elo_history` - per-match Elo snapshots (elo_before, elo_after, elo_change, match_id, season_id); inactivity penalty rows have match_id = null
- `seasons` - number, name, is_active, k_factor, ended_at; only one active season at a time
- `player_achievements` - player_id, achievement_id, unlocked_at; recomputed on every match by the shared achievements function
- `profiles` - linked to `auth.users`, stores role
- `banners` - marquee announcements: message, optional `starts_at`/`ends_at` window, `is_active` master switch, `audience` (`everyone` | `members`), and `season_id` on the one a season start created (unique, so the trigger is idempotent). `message` is nullable *only* when `season_id` is set (`banner_message_present`), which is how "use the translated default" is stored. SELECT is deliberately wider than "currently live": future-scheduled rows are readable so an already-open client can reveal one the moment its window opens (nothing changes in the DB at that instant, so no realtime event would trigger a refetch). Hidden and expired rows are admin-only, and `members` rows are never sent to anonymous callers. An `AFTER INSERT` trigger on `seasons` (`create_season_banner`) adds the 14-day season announcement
- `team_names` - optional name + 2 aliases + color per canonical player pair (player_id_lo < player_id_hi); stats derived at runtime in `teamUtils.ts`, not stored; only teams with ≥ 2 matches are shown

### Elo Calculation (Deno function)

- Standard Elo with K configurable per season (default 32)
- In 2v2: each player's expected score averages against both opponents
- **Season Elo used for math**: the function fetches `player_season_stats.current_season_elo` for the 4 players and uses those values for `calculateNewElo()`. The resulting delta is then applied to `players.current_elo` (all-time). This ensures all players start equal (1500) at the beginning of each season.
- `elo_history` always stores all-time Elo values (`elo_before`/`elo_after`); season-normalized display is derived in the frontend using `1500 + (alltime - elo_at_start)`
- On match record: updates player ELOs, writes to `elo_history`, then calls `recomputeAllAchievements` from `supabase/functions/_shared/achievements.ts`
- Shared achievements logic lives in `_shared/` so it can be imported by both the edge function and tests

### CI
Two GitHub Actions workflows run on push/PR to main:
- `.github/workflows/deno.yml` - `deno lint` + `deno test -A` (edge function, scoped to `supabase/functions/calculate-elo/`, uses Deno v2)
- `.github/workflows/frontend.yml` - `pnpm lint` + `pnpm test` (frontend, pnpm workspace, single root lockfile)

### Type checking
`pnpm build` runs `vite build` only, and `pnpm lint` is not type-aware, so **neither catches type errors**. `pnpm exec tsc --noEmit` does, but currently reports pre-existing errors in `Leaderboard.tsx` (null index types, `Array.prototype.at` needing a newer `lib`) and `supabase.ts` (`import.meta.env`). Worth knowing before trusting a green build.

### Testing
- **Frontend:** Vitest + React Testing Library; test files colocated with source (`*.test.ts(x)`)
- **Edge function:** Deno test runner; `elo_test.ts` covers pure Elo math (`getExpectedScore`, `calculateNewElo`)
- Imports for the edge function declared in `deno.json` (not inline `jsr:`/`https:` specifiers - enforced by linter)

### Theming

Three themes selectable via a ☀️/🌙/🪟 toggle in the header; choice saved in cookie `toegg-theme`.

- **Light** (default) - existing design unchanged
- **Dark** - CSS variable overrides on `[data-theme="dark"]`; hardcoded `white` backgrounds in dialogs overridden via `[data-theme="dark"] .bg-white`
- **Win95** - teal desktop + custom Win95 window chrome (`Win95Shell`); uses `@react95/core` (v9) for Win95 CSS variables/theming imported via `@react95/core/themes/win95.css`; component styles overridden via `[data-theme="win95"]` in `App.css`

**Win95 dialogs** are styled entirely from CSS off one `modal-panel` hook class, which all four modals (PlayerDetail, TeamDetail, PlayerModal, SeasonDialog) carry. Their first child is already the heading - either the `<h2>` itself or a header row holding it plus a close button - which is exactly a title bar's shape, so `[data-theme="win95"] .modal-panel > :first-child` becomes one. That is why no dialog contains Win95-specific markup, and why a new dialog only needs the class. The panel padding is normalised to the 3px window frame so the title bar's full-bleed has a single value to cancel.

**`--control-h`** is the shared height for the compact controls that share a card's header row (season select, `.lb-toggle` segmented toggles, `.player-ac--compact`). They each used to pick their own padding and so lined up at three different heights; anything new on such a row should use it too.

`ThemeProvider` must wrap `AuthProvider` in `main.tsx`. Do **not** use react95's `Modal` component as the window frame - it attaches drag event listeners that break inner click handlers; `Win95Shell` uses plain HTML instead.

### Workspace layout
Root `package.json` + `pnpm-workspace.yaml` declare `frontend` as a pnpm workspace package. Husky is installed at root; `pnpm-lock.yaml` is committed at root (not gitignored).
