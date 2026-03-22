# TöggELO

A dashboard to track 2v2 table soccer (foosball) matches and rank players using the Elo ranking system.

## Features

- Record 2v2 matches and automatically recalculate ELO ratings
- Leaderboard with player rankings and ELO history charts
- Match history with per-match ELO changes
- Role-based access: viewers, users (can record matches), admins
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

## Tech Stack

- **Frontend:** React 19 + Vite + TypeScript
- **Backend:** Supabase (PostgreSQL, Auth, Row-Level Security)
- **ELO calculation:** Deno edge function

## Setup

1. Create a [Supabase](https://supabase.com) project and run the migrations in `supabase/migrations/` in order.
2. Deploy the edge function in `supabase/functions/calculate-elo/`.
3. Copy `frontend/.env.example` to `frontend/.env.local` and fill in your Supabase URL and anon key.
4. Install dependencies and start the dev server:

```bash
cd frontend
pnpm install
pnpm dev
```

The app runs at `http://localhost:5173`.

## Scripts

```bash
pnpm dev      # Start development server
pnpm build    # Production build
pnpm lint     # Lint
```
