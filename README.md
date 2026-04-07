# TöggELO

A dashboard to track 2v2 table soccer (foosball) matches and rank players using the Elo ranking system.

## Features

- Record 2v2 matches and automatically recalculate ELO ratings
- **Timeline** — reverse-chronological daily activity feed showing match results (with per-player ELO deltas), achievements earned, rank changes, and season transitions; shown first to logged-in users
- **Leaderboard** with player rankings, sortable by ELO / name / winrate, with ELO history charts; season-filtered
- **Player detail modal** with ELO progression, winrate chart, Top Enemy & Nemesis stats, season dropdown, and ‹ › keyboard navigation (← → / A D)
- **Teams tab** — all player pairs (≥ 2 matches) with combined ELO, win rate, nemesis rival, custom names/colors; season-filtered
- **Achievements tab** — per-player achievement tracking (users/admins only)
- Match history with per-match ELO changes and season badge
- Season support: all views filter by season; each season has its own K-factor
- Role-based access: viewers (read-only), users (record matches, edit, achievements), admins (full control)
- Magic link login

## ELO Calculation

Each player starts at **1500 ELO**. After every match, ratings are updated using the standard ELO formula with **K = 32**.

In a 2v2 match, each player is evaluated individually against both opponents. The expected score for a player is averaged across both opponents:

```
E = ( 1/(1 + 10^((Ra - P)/400)) + 1/(1 + 10^((Rb - P)/400)) ) / 2
```

Where `P` is the player's current ELO and `Ra`, `Rb` are the two opponents' ELOs.

The new rating is then:

```
newELO = oldELO + K * (actual - expected)
```

Where `actual` is `1` for a win and `0` for a loss. All four players in a match are updated this way, and the changes are recorded in the ELO history for trend visualization.

K-factor is configurable per season (default 32).

## Tech Stack

- **Frontend:** React 19 + Vite + TypeScript
- **Backend:** Supabase (PostgreSQL, Auth, Row-Level Security)
- **ELO calculation:** Deno edge function

## Setup

1. Create a [Supabase](https://supabase.com) project and run the migrations in `supabase/migrations/` in order.

2. Install the [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) (e.g. via npm):

   ```bash
   npm install -g supabase
   ```

3. Log in to the Supabase CLI and link your project:

   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   ```

4. Deploy the edge function:

   ```bash
   supabase functions deploy calculate-elo --project-ref <your-project-ref>
   ```

5. Copy `frontend/.env.example` to `frontend/.env.local` and fill in your Supabase URL and anon key.

6. Install dependencies and start the dev server:

   ```bash
   cd frontend
   pnpm install
   pnpm dev
   ```

The app runs at `http://localhost:5173`.

## Deployment

Frontend is on Vercel (one project, auto-deployed). Edge function must be deployed manually to the matching Supabase project after each change.

### Preview / staging

1. Open a pull request — Vercel preview deployment is created automatically.

2. Deploy the edge function to the **staging** Supabase project:

   ```bash
   supabase functions deploy calculate-elo --project-ref <staging-project-ref>
   ```

### Production

1. Merge the pull request — Vercel deploys to production automatically.

2. Deploy the edge function to the **production** Supabase project:

   ```bash
   supabase functions deploy calculate-elo --project-ref <prod-project-ref>
   ```

## Scripts

```bash
pnpm dev      # Start development server
pnpm build    # Production build
pnpm lint     # Lint
pnpm test     # Run Vitest unit/component tests
```
