# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TöggELO (Töggeli Elo) — a dashboard to track 2v2 table soccer (foosball) matches and rank players using the Elo ranking system.

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
- `frontend/src/lib/supabase.ts` — all Supabase queries and mutations; single source of truth for data access
- `frontend/src/contexts/AuthContext.tsx` — wraps the app, exposes `useAuth()` with user, role, and auth methods
- `frontend/src/contexts/ThemeContext.tsx` — exposes `useTheme()` with `theme` (`"light" | "dark" | "win95"`) and `setTheme()`; persists selection in cookie `toegg-theme` (1-year); sets `data-theme` on `<html>` synchronously to avoid flash
- `frontend/src/lib/i18n.ts` — i18next init (imported once in `main.tsx`); components call `useTranslation()` for `t()`. English (`en`, fallback) + German (`de`), with strings in `frontend/src/locales/{en,de}.json`; language persisted in cookie `toegg-lang` via `i18next-browser-languagedetector` (detection order cookie → browser, `de-CH` normalized to `de`). Also exports `DATE_LOCALE` (`'de-CH'`) — the fixed locale every `toLocale*String` date/time call uses, so dates stay Swiss-formatted (dd.mm.yyyy) regardless of UI language. Achievement names/descriptions are translated at the display layer under the `achievementDefs.<id>` keys (the `ACHIEVEMENT_DEFINITIONS` in `achievements.ts` stay English as the shared backend source + fallback)
- `frontend/src/App.tsx` — main orchestrator; fetches all state in one TanStack Query (`fetchAppData`, key `["appData", userId, role]`) and refetches via `refresh()` (`invalidateQueries`), passes data + callbacks to children; manages `selectedSeason` shared across Leaderboard, Teams, and PlayerDetail
- `frontend/src/lib/teamUtils.ts` — pure team stat computation (`computeTeamStats`, `teamColor`, `teamKey`); no DB calls
- `frontend/src/lib/achievements.ts` — `ACHIEVEMENT_DEFINITIONS` array; shared between frontend and the `_shared` edge function
- `frontend/src/lib/rosterFilter.ts` — who counts as "part of the season": a player is **ranked** only at `RANKED_MIN_GAMES` (3) games in the season in scope. `filterRoster(players, "all" | "played" | "ranked")` drives the Leaderboard's roster toggle (table *and* both charts, since they all consume the same filtered list). The two narrowing views are gated on how much they'd actually show — `isFilterAvailable` offers one at `FILTER_MIN_ENTRIES` (1) player, `defaultRosterFilter` auto-selects the narrowest at `AUTO_SELECT_MIN_ENTRIES` (4 — a 2v2 match *is* 4 players, so the played view takes over from the very first recorded game), else falls back to `all`. So a view is never *entered* empty and never *defaults* to a board too thin to read. `resolveRosterFilter` drops a pinned choice that has no data in the current scope (e.g. switching to a season where nobody qualifies) rather than stranding the user on an empty board behind a disabled button. Callers pass season-scoped players (Leaderboard overrides `matches_played` with the season's wins+losses), so the same helper serves season and all-time views. No DB calls
- `frontend/src/lib/seasonStats.ts` — pure headline-stat computation (`computeSeasonStats`): games played, active players, longest win/lose streak, best/worst day, biggest win/loss, highest/lowest Elo (season-normalized for a season, raw all-time otherwise), busiest day, win-rate leader, achievements unlocked, games-by-weekday, per-day activity + date range; no DB calls
- `frontend/src/lib/relationshipGraph.ts` — pure league-wide relationship computation (`computeRelationshipGraph`): nodes = players who played, friend edges = games as teammates, foe edges = games as opponents. Foe records are directional on an undirected `lo:hi` key — always stored from `lo`'s side, with `loShare` (0..1) driving the tug-of-war split. `topEdgesPerPlayer` keeps each player's N strongest links and drops the rest; **an absolute "min games" threshold does not work here** — with ~12 players everyone eventually partners with and faces everyone, so the graph is complete (all C(n,2) pairs) at any realistic match volume. Filters edges only, never nodes. No DB calls. Overlaps `computeTeammateCounts`/`computeOpponentCounts` (`achievements.ts`) and the private `computeHeadToHead` (`PlayerDetail.tsx`) — those are per-player, this is league-wide; consolidating them is open work
- `frontend/src/lib/colors.ts` — palette constants mirroring the CSS vars, plus `hashHue`/`hslHex` (seed string → stable HSL → hex, used by `teamColor` in `teamUtils.ts`) and `RELGRAPH_SLOTS`. Note `Leaderboard.tsx` keeps its own file-private index-based `playerColor` for evenly-spaced bump-chart hues — deliberately different
- `frontend/src/components/RelationshipGraph.tsx` — force-directed player network. Uses `d3-force-3d` for layout math only (it covers both modes via `numDimensions(2|3)`); the SVG is rendered here, so colors stay CSS vars, all three themes work, and the tug-of-war edges keep working. `frontend/src/types/d3-force-3d.d.ts` hand-declares the package (it ships no types). Key invariants:
  - **3D must seed nodes on a sphere** (`seedPosition`): with every z at 0 the repulsion has no z-component and the layout stays flat forever. Switching 2D→3D re-seeds for the same reason
  - Friends|Foes swaps the link set on the *same* simulation so nodes hold position; dimension/data/canvas changes rebuild it
  - `chargeFor()` scales repulsion to the room per node — a fixed charge either knots up on a large canvas or flings nodes off a small one
  - `WARMUP_TICKS` runs the settle synchronously (`tick()` fires no events) so the graph arrives near-settled instead of animating hundreds of rendered frames
  - Projection is one path: 2D is the 3D projection with zero rotation and z = 0, which reduces to identity
  - Nodes are draggable (pointer capture → `fx`/`fy`/`fz` pinning → `alphaTarget(0.3)`); a press that never moves counts as a click. Background drag orbits in 3D, pans in 2D; wheel zooms (registered non-passively by hand, since React's synthetic wheel handler is passive)
  - **Node colour is not identity — the labels are.** No palette of ~12 perceptually distinct colours exists (measured with the dataviz skill's validator: past six, pairs fall under the ΔE 15 normal-vision floor; the old id-hash scheme scored 5.8, i.e. indistinguishable). So the six `--relgraph-c1..c6` vars are assigned by graph colouring (`assignColorSlots`) purely so linked players never match — which is what makes the two-tone foe edges readable. Clean at the default budget; the friend+foe union can force a repeat at budget 5+. Slot → hex lives in CSS, so themes still work without the component knowing the theme
  - Friend edges are **directed**: game counts are symmetric but preference isn't, so `loPicked`/`hiPicked`/`mutual` mark an unrequited favourite with an arrow (one `auto-start-reverse` marker serves both ends)
  - Scopes seasons locally and defaults to all-time, rather than using App's shared `selectedSeason` — so App passes it the **unfiltered** `allPlayerSeasonStats`
- `frontend/src/components/ActivityHeatmap.tsx` — pure presentational GitHub-style contribution graph (weeks as columns, Mon→Sun rows, oldest left → most recent right) of per-day match counts; pads the window backwards to `minWeeks` (default 13 ≈ 3 months) and highlights the `firstDay` cell in purple; used by SeasonStats
- `frontend/src/components/` — tab-based UI: Timeline, Leaderboard, Teams, TeamDetail, RelationshipGraph, MatchForm, MatchHistory, PlayerDetail/Modal, SeasonStats, ActivityHeatmap, Achievements, UserManagement, SeasonDialog, ThemeToggle, LanguageSwitcher, Win95Shell
- `frontend/src/test/setup.ts` — Vitest setup (jest-dom matchers, ResizeObserver mock, i18n init so components render real strings in tests)

**Tab visibility rules:**

- Timeline: logged-in users only; shown as first tab when authenticated
- Teams and Relationships: logged-in users only (any role, including `viewer`)
- Record Match, Achievements: `user` or `admin` role only
- Admin (user management + achievement recompute): `admin` only
- Leaderboard and History: always visible

### Data Flow
1. `App.tsx` fetches everything through one TanStack Query; mutations call `refresh()` to invalidate it
2. All DB interactions go through helper functions in `supabase.ts`
3. Match recording invokes the `calculate-elo` Deno edge function via `supabase.functions.invoke()`
4. Child components call parent-provided callbacks to trigger data refresh

### Auth & Roles
Three roles enforced at DB level via Row-Level Security (RLS):
- `viewer` — read-only (default on signup)
- `user` — can record matches and manage players
- `admin` — full control including deletes and user role management

A `handle_new_user()` trigger auto-creates a `viewer` profile in the `profiles` table on signup. Magic link (OTP) login is supported.

### Database Schema (key tables)
- `players` — name, current_elo (default 1500), matches_played, wins, losses
- `matches` — team_a/team_b player IDs (2v2), winning_team, season_id
- `elo_history` — per-match Elo snapshots (elo_before, elo_after, elo_change, match_id, season_id); inactivity penalty rows have match_id = null
- `seasons` — number, name, is_active, k_factor, ended_at; only one active season at a time
- `player_achievements` — player_id, achievement_id, unlocked_at; recomputed on every match by the shared achievements function
- `profiles` — linked to `auth.users`, stores role
- `team_names` — optional name + 2 aliases + color per canonical player pair (player_id_lo < player_id_hi); stats derived at runtime in `teamUtils.ts`, not stored; only teams with ≥ 2 matches are shown

### Elo Calculation (Deno function)

- Standard Elo with K configurable per season (default 32)
- In 2v2: each player's expected score averages against both opponents
- **Season Elo used for math**: the function fetches `player_season_stats.current_season_elo` for the 4 players and uses those values for `calculateNewElo()`. The resulting delta is then applied to `players.current_elo` (all-time). This ensures all players start equal (1500) at the beginning of each season.
- `elo_history` always stores all-time Elo values (`elo_before`/`elo_after`); season-normalized display is derived in the frontend using `1500 + (alltime - elo_at_start)`
- On match record: updates player ELOs, writes to `elo_history`, then calls `recomputeAllAchievements` from `supabase/functions/_shared/achievements.ts`
- Shared achievements logic lives in `_shared/` so it can be imported by both the edge function and tests

### CI
Two GitHub Actions workflows run on push/PR to main:
- `.github/workflows/deno.yml` — `deno lint` + `deno test -A` (edge function, scoped to `supabase/functions/calculate-elo/`, uses Deno v2)
- `.github/workflows/frontend.yml` — `pnpm lint` + `pnpm test` (frontend, pnpm workspace, single root lockfile)

### Testing
- **Frontend:** Vitest + React Testing Library; test files colocated with source (`*.test.ts(x)`)
- **Edge function:** Deno test runner; `elo_test.ts` covers pure Elo math (`getExpectedScore`, `calculateNewElo`)
- Imports for the edge function declared in `deno.json` (not inline `jsr:`/`https:` specifiers — enforced by linter)

### Theming

Three themes selectable via a ☀️/🌙/🪟 toggle in the header; choice saved in cookie `toegg-theme`.

- **Light** (default) — existing design unchanged
- **Dark** — CSS variable overrides on `[data-theme="dark"]`; hardcoded `white` backgrounds in dialogs overridden via `[data-theme="dark"] .bg-white`
- **Win95** — teal desktop + custom Win95 window chrome (`Win95Shell`); uses `@react95/core` (v9) for Win95 CSS variables/theming imported via `@react95/core/themes/win95.css`; component styles overridden via `[data-theme="win95"]` in `App.css`

`ThemeProvider` must wrap `AuthProvider` in `main.tsx`. Do **not** use react95's `Modal` component as the window frame — it attaches drag event listeners that break inner click handlers; `Win95Shell` uses plain HTML instead.

### Workspace layout
Root `package.json` + `pnpm-workspace.yaml` declare `frontend` as a pnpm workspace package. Husky is installed at root; `pnpm-lock.yaml` is committed at root (not gitignored).
