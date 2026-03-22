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
pnpm preview    # Preview production build
```

### Supabase Edge Function (run from `supabase/functions/calculate-elo/`)
```bash
deno lint       # Lint the function
deno test -A    # Run tests
```

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
- `frontend/src/App.tsx` — main orchestrator; owns `loadData()` for refetching all state, passes data + callbacks to children
- `frontend/src/lib/teamUtils.ts` — pure team stat computation (`computeTeamStats`, `teamColor`, `teamKey`); no DB calls
- `frontend/src/components/` — tab-based UI: Leaderboard, Teams, TeamDetail, MatchForm, MatchHistory, PlayerDetail/Modal, UserManagement

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
- `matches` — team_a/team_b player IDs (2v2), winning_team
- `elo_history` — per-match ELO snapshots (elo_before, elo_after, elo_change)
- `profiles` — linked to `auth.users`, stores role
- `team_names` — optional name + 2 aliases + color per canonical player pair (player_id_lo < player_id_hi); stats are derived from matches at runtime in `teamUtils.ts`, not stored

### ELO Calculation (Deno function)
- Standard ELO with K=32
- In 2v2: each player's expected score averages against both opponents
- On match record: updates player ELOs and writes to `elo_history`

### CI
GitHub Actions (`.github/workflows/deno.yml`) runs `deno lint` and `deno test -A` on push/PR to main.
