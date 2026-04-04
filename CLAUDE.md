# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TöggELO (Töggeli ELO) — a dashboard to track 2v2 table soccer (foosball) matches and rank players using the Elo ranking system.

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
- **Frontend:** React 19 + Vite + TypeScript, Recharts for ELO history charts
- **Backend:** Supabase (PostgreSQL + Auth + RLS)
- **Edge Function:** Deno (`supabase/functions/calculate-elo/`) for ELO computation
- **Package manager:** pnpm

### Frontend Structure
- `frontend/src/lib/supabase.ts` — all Supabase queries and mutations; single source of truth for data access
- `frontend/src/contexts/AuthContext.tsx` — wraps the app, exposes `useAuth()` with user, role, and auth methods
- `frontend/src/App.tsx` — main orchestrator; owns `loadData()` for refetching all state, passes data + callbacks to children; manages `selectedSeason` shared across Leaderboard, Teams, and PlayerDetail
- `frontend/src/lib/teamUtils.ts` — pure team stat computation (`computeTeamStats`, `teamColor`, `teamKey`); no DB calls
- `frontend/src/lib/achievements.ts` — `ACHIEVEMENT_DEFINITIONS` array; shared between frontend and the `_shared` edge function
- `frontend/src/components/` — tab-based UI: Timeline, Leaderboard, Teams, TeamDetail, MatchForm, MatchHistory, PlayerDetail/Modal, Achievements, UserManagement, SeasonDialog
- `frontend/src/test/setup.ts` — Vitest setup (jest-dom matchers, ResizeObserver mock)

**Tab visibility rules:**

- Timeline: logged-in users only; shown as first tab when authenticated
- Teams, Record Match, Achievements: `user` or `admin` role only
- Users: `admin` only
- Leaderboard and History: always visible

### Data Flow
1. `App.tsx` calls `loadData()` on mount and after any mutation
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
- `elo_history` — per-match ELO snapshots (elo_before, elo_after, elo_change, match_id, season_id); inactivity penalty rows have match_id = null
- `seasons` — number, name, is_active, k_factor, ended_at; only one active season at a time
- `player_achievements` — player_id, achievement_id, unlocked_at; recomputed on every match by the shared achievements function
- `profiles` — linked to `auth.users`, stores role
- `team_names` — optional name + 2 aliases + color per canonical player pair (player_id_lo < player_id_hi); stats derived at runtime in `teamUtils.ts`, not stored; only teams with ≥ 2 matches are shown

### ELO Calculation (Deno function)

- Standard ELO with K configurable per season (default 32)
- In 2v2: each player's expected score averages against both opponents
- On match record: updates player ELOs, writes to `elo_history`, then calls `recomputeAllAchievements` from `supabase/functions/_shared/achievements.ts`
- Shared achievements logic lives in `_shared/` so it can be imported by both the edge function and tests

### CI
Two GitHub Actions workflows run on push/PR to main:
- `.github/workflows/deno.yml` — `deno lint` + `deno test -A` (edge function, scoped to `supabase/functions/calculate-elo/`, uses Deno v2)
- `.github/workflows/frontend.yml` — `pnpm lint` + `pnpm test` (frontend, pnpm workspace, single root lockfile)

### Testing
- **Frontend:** Vitest + React Testing Library; test files colocated with source (`*.test.ts(x)`)
- **Edge function:** Deno test runner; `elo_test.ts` covers pure ELO math (`getExpectedScore`, `calculateNewElo`)
- Imports for the edge function declared in `deno.json` (not inline `jsr:`/`https:` specifiers — enforced by linter)

### Workspace layout
Root `package.json` + `pnpm-workspace.yaml` declare `frontend` as a pnpm workspace package. Husky is installed at root; `pnpm-lock.yaml` is committed at root (not gitignored).
