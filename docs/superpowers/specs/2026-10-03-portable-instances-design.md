# Portable Instances - Design

Issue: [#56 Make the project easily portable and usable for everyone](https://github.com/miltronius/toegg-elo/issues/56)

## Goal

Let any company run its own TöggElo ⚽ league with as little setup as possible, while
`miltronius/toegg-elo` stays the **golden source**: every instance runs a tagged release
of this repo, and new releases reach every instance automatically.

## Decisions

| Question | Decision |
|---|---|
| Who operates an instance? | **The adopting company**, on its own accounts (GitHub, Supabase, Vercel). We never touch their infrastructure or data. |
| What can an adopter change? | **Nothing in code.** Their GitHub repo holds no app code - only one workflow file and secrets - so an update can never conflict with anything of theirs. Anyone who wants code changes forks unsupported. |
| Where do company options live? | In the database, edited under **Admin**. No config file. |
| Branding | **Fixed: TöggElo ⚽** on every instance. No rename, no emoji choice. |
| Frontend hosting | **Vercel only.** Another host: contact us (issue). |
| Update channel | **Follow a major version**: an instance tracks `v1`; every `1.x.y` arrives automatically within a day, `2.0` waits for a one-line edit. Plus a manual "update now". |
| How the code reaches the instance | A **reusable workflow in this repo**, called by the instance's workflow at `@v1`. The deploy logic itself updates with releases. |
| Email | **Works without email by default.** Fresh instances turn "Confirm email" off; the magic link is hidden until an admin switches it on (after configuring SMTP). |
| Admin settings | One: **magic link on/off**. Date format (`de-CH`), language, theme and the "suggest an achievement" link stay as they are. |

## Current state (what ties the app to one office)

- **Database**: 24 migrations applied by hand in the SQL editor, several of them
  historical fixes and backfills of our own data. Duplicate date prefixes
  (`20260203_*` ×2, `20260404_*` ×3, ...) make them unusable by the Supabase CLI. No
  `supabase/config.toml`. Season 1 is created from existing match data.
- **First admin**: every sign-up is a `viewer`; promoting the first admin takes hand-written SQL.
- **Email**: Supabase's built-in mailer only delivers to the Supabase project's team
  members, a few per hour. Sign-up confirmation and magic link both depend on it.
- **Hosting**: Vercel git integration, plus a manual `supabase functions deploy`; the
  auth Site URL / redirect list set by hand in the dashboard.
- **Release-order notes** ("migration before function before frontend") followed by hand.
- **Security**: `set_banner_order` and `apply_inactivity_penalties` are still callable by
  `anon` (see CLAUDE.md). Tolerable inside one office, not when handing the app to others.

## 1. Database

### Baseline

`supabase/migrations/20261003000000_baseline.sql` holds the schema **exactly as it runs on prod
today** - this is the issue's "get the DB schema". Built in two steps:

1. Apply the 24 old files to an empty local Supabase, dump prod's schema, diff the two.
   Every difference is drift (e.g. the open delete policies found in September) and is
   resolved explicitly, never copied blindly.
2. Add by hand what a `public`-schema dump drops or gets wrong:
   - a REVOKE before the dumped grants, so they come out exactly as on prod (see
     Findings - without it the restore re-opens locked functions to `anon`),
   - the `on_auth_user_created` trigger on `auth.users`,
   - a seed: insert Season 1 when `seasons` is empty, on the new-season dialog's
     defaults (K 48, partner weight 0.25 - the column default for K is still 32); the
     `create_season_banner` trigger then adds its welcome banner.

   (The realtime publication *is* in the dump; prod has no pg_cron, so no cron job.)

The baseline is **marked as applied** on staging and prod (`supabase migration repair
--status applied 20261003000000`), never run there. So anything new - including the anon hotfix -
is a **regular migration after the baseline**, or our own databases would never get it.

The old files move to `supabase/archive/migrations/`, where the CLI ignores them and
CLAUDE.md's many references to them stay readable.

### Migrations from now on

- Created with `supabase migration new` (`YYYYMMDDHHMMSS_name.sql`), applied with
  `supabase db push` - on our staging and prod too (prod still only with explicit
  go-ahead), so they carry the same history as every instance.
- `supabase/config.toml` is added (needed for local Supabase / CI and the CLI).
- **Rule 1 - backward compatible:** every migration keeps the *previous release's*
  frontend and function working, because instances update database → function →
  frontend, and an instance may lag a release.
- **Rule 2 - portable data fix-ups:** a backfill written for our data must be harmless
  on anyone else's (empty or different) database.
- The existing "re-runnable" convention stays.

### New migrations after the baseline

1. **Anon hotfix**: re-create `set_banner_order` and `apply_inactivity_penalties` with
   `COALESCE(get_my_role(), '')` role checks; `REVOKE EXECUTE ... FROM PUBLIC, anon`.
2. **Instance tables + bootstrap** (Section 3).

## 2. Delivery pipeline

### In this repo

- `.github/workflows/deploy-instance.yml` (`on: workflow_call`) - all the logic.
- `instance/deploy.yml` - the file adopters copy (no separate template repo).
- The release workflow, right after creating `vX.Y.Z`, force-moves the major tag
  (`v1`) to it. A future `2.0` creates `v2`; `v1` stays on the last `1.x`. The first
  release containing the pipeline creates `v1`.
- The reusable workflow knows its own track as a constant (`TRACK: v1`), bumped in the
  same PR that goes to 2.0 (documented in CLAUDE.md). It checks out
  `miltronius/toegg-elo` at `TRACK` unless the optional input `ref` overrides it
  (used to test the branch before release).

### In the instance repo

Only the copied `deploy.yml`:

- triggers: daily `schedule` + `workflow_dispatch` ("update now")
- `uses: miltronius/toegg-elo/.github/workflows/deploy-instance.yml@v1`, with the
  variables as inputs and each secret passed explicitly (`secrets: inherit` only works
  within one GitHub organization)
- a `concurrency` group so a manual and a scheduled run never overlap
- the repository should be **private**: GitHub disables scheduled workflows in public
  repositories after 60 days without activity

| Name | Kind | Purpose |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | secret | CLI: push migrations, deploy the function, read API keys, Management API |
| `SUPABASE_DB_PASSWORD` | secret | `db push` connects to Postgres directly |
| `VERCEL_TOKEN` | secret | Find or create the Vercel project (REST API) and publish to it |
| `ADMIN_EMAIL` | secret | First admin (Section 3) |
| `SUPABASE_PROJECT_REF` | variable | Which Supabase project |
| `VERCEL_PROJECT` | variable | Vercel project name; the first run creates it |
| `VERCEL_TEAM_ID` | variable | Optional: the Vercel team owning it |
| `SITE_URL` | variable | Public URL, for auth redirects |

No `VITE_SUPABASE_*` to copy: the URL is `https://<ref>.supabase.co`, the browser key
(publishable, else legacy anon) is read from the Management API. No Vercel org/project
IDs either: the dashboard can only create Git-connected projects, so the workflow
creates the project by name.

### A run

1. Check out this repo at `TRACK` (or `ref`); note the commit SHA and the version from
   `frontend/package.json`.
2. Read `instance_state` from the instance database. If the recorded SHA equals the
   checkout's, stop - nothing to do. (No table or no recorded deploy = first install.)
3. `supabase db push`.
4. **First install only**: set the auth config through the Management API - Site URL and
   redirect list from `SITE_URL`, "Confirm email" off - and record
   `instance_state.auth_configured_at`. Done exactly once, so later runs (retries after
   a failed deploy included) never overwrite what an adopter changes in the dashboard
   afterwards (e.g. SMTP).
5. `supabase functions deploy calculate-elo`.
6. `select bootstrap_admin(ADMIN_EMAIL)` (Section 3) - on every run, deploy or not.
7. `pnpm build`; write the output in Vercel's Build Output API v3 layout
   (`.vercel/output/static` + `config.json`); `vercel deploy --prebuilt --prod`. Nothing
   is built on Vercel, so the project needs no settings (no root directory, framework or env).
8. Record SHA, version and time in `instance_state`.

A failure anywhere leaves the SHA unrecorded, so the next run retries; every step is
idempotent. A failed `db push` stops the run before the frontend changes, so the old
frontend keeps running against an unchanged schema. GitHub emails the repo owner when a
scheduled run fails.

**Our own instance doesn't use this pipeline**: Vercel from `main` and migrations by hand
(now via `db push`). That makes it the canary - everything reaches us first, adopters
only get it once tagged.

## 3. Bootstrap and settings

### `app_settings` (public)

- Exactly one row (singleton, enforced by a constant primary key + CHECK).
- `magic_link_enabled boolean NOT NULL`.
- SELECT for everyone, logged-out included (the login screen needs it); UPDATE for
  admins only, role check with `COALESCE`. No INSERT/DELETE.
- The creating migration inserts the row with `magic_link_enabled = EXISTS (SELECT 1 FROM
  players)`: a league that existed before keeps its magic link, a fresh instance starts
  without it.
- Read together with the other app data and passed to:
  - the login screen: the password/magic-link toggle is hidden when it's off (password only);
  - Admin: an **"Instance settings"** card (with an `ADMIN_SECTIONS` entry) holding the
    switch and a hint that SMTP has to be configured in Supabase first.
- New strings in `en.json` and `de.json`.

### `instance_state` (private)

- One row: `deployed_sha`, `deployed_version`, `deployed_at`, `auth_configured_at`,
  `bootstrap_admin_email`.
- RLS on, no policies, all privileges revoked from `anon`/`authenticated`. Only the
  workflow, connecting as `postgres`, reads or writes it.

### First admin

`bootstrap_admin(email text)`, `SECURITY DEFINER`, EXECUTE revoked from `PUBLIC`,
`anon`, `authenticated`; called by every workflow run:

- an admin exists → no-op;
- an account with that email exists → promote it to `admin`;
- otherwise → store the email as pending in `instance_state`.

`handle_new_user()` gains: when no admin exists and the new user's email matches the
pending one (case-insensitive), the profile is created as `admin` and the pending email
cleared.

With email confirmation off, whoever signs up first with that address becomes admin.
The address is a secret and the window is short; the guide says to sign up right after
the first deploy. Side benefit: an instance that lost its last admin gets one back on
the next run.

## 4. Docs

- **`docs/self-hosting.md`**, linked from the README:
  - prerequisites: three free accounts (GitHub, Supabase, Vercel);
  - step by step: Supabase project, empty Vercel project, instance repo + `deploy.yml`,
    secrets and variables, first run, sign up as admin;
  - optional: SMTP + the magic-link switch; custom domain (update `SITE_URL` and the
    Supabase redirect list);
  - updates: `1.x` automatic, `2.0` a one-line edit;
  - troubleshooting: free Supabase projects pause after 7 idle days; failed runs email
    the repo owner; how to re-run;
  - "Another host or a feature? Open an issue."
- **README**: the Elo section (K = 32, per-opponent formula) is outdated - corrected to
  the current margin model in brief, pointing at CLAUDE.md for detail. Deployment
  section updated for `db push`.
- **CLAUDE.md**: instance concept, the migration rules (incl. explicit grants), `db push` workflow, the
  `v1` tag and `TRACK` constant, the new tables and `bootstrap_admin`.
- **Changeset** (minor): the magic-link switch and self-hosting.

## 5. Testing

- **Migrations CI** (new job in a new `.github/workflows/database.yml`, Docker on the runner):
  - fresh install: start a local Supabase from empty, apply all migrations;
  - upgrade: apply the newest release tag's migrations, then the branch's (skipped
    while no release has the baseline yet);
  - run every `supabase/scripts/*-checks.sql` (already self-asserting, rolled back);
  - fail if a new migration's timestamp sorts before an already-released one
    (`db push` would refuse it on every instance).
- **`supabase/scripts/instance-bootstrap-checks.sql`**: `bootstrap_admin` in all three
  states, the `handle_new_user` promotion, `app_settings` RLS (anon reads, user can't
  update, admin can), `instance_state` invisible to `anon`/`authenticated`.
- **`supabase/scripts/function-access-checks.sql`**: the anon hotfix, plus an allowlist
  of the SECURITY DEFINER functions `anon` may execute, so the next one can't land as a
  public endpoint unnoticed.
- **Frontend unit tests**: login screen with the switch on/off; the Admin card.
- **`actionlint`** on the workflow files, in CI.
- **End-to-end** (needs your accounts, so after your return, before the merge): a test
  instance repo against a **fresh** Supabase project - staging can't test this, since it
  has the legacy keys and old default grants that new projects lack (see Findings). The
  free tier allows two active projects, so pause staging for it or use a paid slot.
  Staging then covers the "existing instance updates" path.

## Rollout

- All work on branch `elo-56-portable-instances`. **Not merged to `main`** until you are
  back and have reviewed it (planned absence: ~3 weeks from 2026-10-03).
- Before merge: end-to-end run against a fresh project; staging and prod
  `migration repair` of the baseline and `db push` of the new migrations (with your
  go-ahead), and `calculate-elo` redeployed.
- After merge: the next release tag creates `v1`; only then can an adopter's
  `deploy.yml` (`@v1`) resolve.

## Out of scope

- Other hosts than Vercel; multi-tenancy; configurable branding, date format, language
  or logo; a separate template repo; backups before migrating (Supabase's own backups
  apply; an artifact dump in a public instance repo would leak data).

## Findings during planning (2026-10-03)

Verified against prod (read-only) and a local Supabase; these shaped the plan.

- **No drift.** The 24 old files replayed on an empty database produce prod's schema
  exactly (`pg_net` aside, a local-image extension). The README's "run them in order"
  path was broken, though: `20260203_deletion_policies.sql` sorts before
  `20260203_initial_schema.sql`, which then fails.
- **A plain dump re-opens locked functions.** pg_dump writes grants relative to
  Postgres' defaults, but Supabase's default privileges grant every new function and
  table to `anon` - so prod's dump, restored as-is, makes `link_player_account` and the
  award helpers callable by `anon` and the read-only tables writable. The baseline
  REVOKEs before the dumped grants; with that, the round trip equals prod exactly.
- **New Supabase projects grant nothing on new tables** to `anon`/`authenticated`
  (default since 2026-05-30, all projects from 2026-10-30). Every new table states its
  grants explicitly (migration rule 3).
- **New projects have no legacy `anon`/`service_role` keys.** The frontend gets the
  publishable key; `calculate-elo` reads `SUPABASE_SECRET_KEYS` with a fallback to
  `SUPABASE_SERVICE_ROLE_KEY`, and is deployed with `verify_jwt = false` (its own auth
  check already is the gate).
- `supabase db push` applies each migration file in one transaction (a failing
  statement left nothing behind locally). `supabase db dump` cleared `search_path`, so
  the baseline's own additions set it back.
- **Prod has no pg_cron** - the inactivity penalties were never scheduled, so the
  baseline schedules nothing. `apply_inactivity_penalties` is called by nothing and
  becomes owner-only. `increment_season_stats` has a stale 4-argument overload
  (SECURITY INVOKER, so harmless) - dropped.
- Two existing award checks assumed an ended season exists; they now create one.
- `secrets: inherit` only works within one GitHub organization; the instance file passes
  each secret. The Vercel dashboard only creates Git-connected projects, so the workflow
  creates the project via the REST API (`POST /v11/projects`) - adopters need no
  org/project IDs.
- With "Confirm email" off, `signUp` returns a session; the login screen now closes
  instead of asking to confirm the address.
- Vercel Hobby is for non-commercial use; the guide tells companies to check whether
  they need Pro.
