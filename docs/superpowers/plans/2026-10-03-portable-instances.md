# Portable Instances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any office run its own TöggElo instance on its own GitHub + Supabase + Vercel accounts, auto-updated from this repo's `v1` release track.

**Architecture:** The database becomes a CLI-managed migration history (one baseline taken from prod plus incremental migrations), guarded by a CI job that installs from empty, upgrades from the last release and runs the SQL rule checks. A reusable workflow in this repo deploys a tagged release to an adopter's projects (migrations → function → first admin → frontend); the adopter's repo only holds a ~25-line caller. Two small tables (`app_settings`, `instance_state`) carry the one admin setting (magic link) and the deploy bookkeeping.

**Tech Stack:** Supabase CLI 2.119 (`db push`, `db start`, `db query`), Postgres 17, GitHub Actions (reusable workflows), Vercel CLI 62 + REST API, React 19 / Vitest, Deno 2.

**Spec:** `docs/superpowers/specs/2026-10-03-portable-instances-design.md` (read its "Findings during planning" section - several decisions below come from it).

## Global Constraints

- All work on branch `elo-56-portable-instances`. **Never merge to `main`, never write to staging or prod.** Prod may only be *read* (schema dump). The user reviews everything after ~2026-10-24.
- Branding is fixed: **TöggElo ⚽**. Frontend hosting: **Vercel only**. Release track: **`v1`**.
- The only admin setting: **magic link on/off** (`app_settings.magic_link_enabled`).
- TS/TSX strings use `"` (the user's editor Prettier rewrites `'`).
- Commit messages: **no `Co-Authored-By` trailer**. The pre-commit hook (lint + vitest + deno lint/test) must pass; never `--no-verify`.
- Every user-visible string in **both** `frontend/src/locales/en.json` and `de.json`.
- Migrations: created with `supabase migration new <name>` (14-digit version), re-runnable, role checks written `COALESCE(get_my_role(), '')`, every SECURITY DEFINER function `REVOKE EXECUTE ... FROM PUBLIC, anon` unless it is meant to be public, every new table `REVOKE ALL ... FROM anon, authenticated` followed by its explicit `GRANT`s (new Supabase projects grant nothing by default, ours grant everything - say it either way).
- Local Supabase for this repo uses ports **544xx** (another local project on the dev machine holds 543xx) and its database container is **`supabase_db_toegg-elo`**.
- Scratch files (prod dump, round-trip dumps) go to the session scratchpad, never into the repo.
- Workflows: Node 22, `supabase/setup-cli@v1` pinned to `2.119.0`.

## Review Focus

1. **An admin email typed differently from the sign-up** (`" Boss@Example.TEST "` vs `boss@example.test`) must still make that sign-up the admin → Task 4 check "the pending address signs up as admin".
2. **A re-run after a half-failed deploy** (migrations done, Vercel failed) must not touch the Supabase auth settings again once they were applied → Task 7 test "a retry after a failed deploy never redoes the auth setup".
3. **Sign-up on an instance that still requires email confirmation** (our prod) must keep saying "check your email", while a no-confirmation instance closes the dialog signed in → Task 6 tests on `AuthScreen`.
4. **A brand-new Supabase project without legacy keys**: the browser gets the publishable key, `calculate-elo` the `SUPABASE_SECRET_KEYS` key, and never a secret key in the bundle → Task 5 `keys_test.ts`, Task 7 `browserKey` tests.
5. **A future SECURITY DEFINER function silently callable with the anon key** (Supabase default privileges grant EXECUTE to anon on every new function) → Task 3 allowlist check in `function-access-checks.sql`, which runs in CI on every PR.

## File Structure

| Path | Responsibility |
|---|---|
| `supabase/config.toml` | Supabase CLI project (local ports, `verify_jwt = false` for `calculate-elo`) |
| `supabase/archive/migrations/*.sql` | The 24 hand-applied migrations, moved verbatim (history only; the CLI ignores them) |
| `supabase/scripts/make-baseline.sh` | Turns a prod schema dump into the baseline migration (provenance of a 1800-line file) |
| `supabase/migrations/20261003000000_baseline.sql` | Prod's schema as of 2026-10-03 + signup trigger + Season 1 seed |
| `supabase/migrations/<ts>_close_function_access.sql` | Anon hotfix + drop stale overload |
| `supabase/migrations/<ts>_instance_settings.sql` | `app_settings`, `instance_state`, `bootstrap_admin`, new `handle_new_user` |
| `supabase/scripts/function-access-checks.sql` | Who may execute which function (allowlist) |
| `supabase/scripts/instance-bootstrap-checks.sql` | Settings RLS/grants + first-admin rules |
| `supabase/scripts/season-award-*-checks.sql` | Existing checks, fixtures made self-sufficient |
| `frontend/scripts/check-migrations.mjs` (+ test) | Migration names and order vs the last release |
| `frontend/scripts/instance-deploy.mjs` (+ test) | Deploy decisions: what to run, which browser key |
| `.github/workflows/database.yml` | CI: names/order, upgrade path, fresh install, SQL checks |
| `.github/workflows/workflows.yml` | CI: actionlint |
| `.github/workflows/deploy-instance.yml` | Reusable deploy pipeline |
| `.github/workflows/release.yml` | + move the `v1` tag on each release |
| `instance/deploy.yml` | The file adopters copy |
| `supabase/functions/calculate-elo/keys.ts` (+ test) | Service key from new or legacy env vars |
| `frontend/src/lib/supabase.ts` | `AppSettings`, `getAppSettings`, `updateAppSettings` |
| `frontend/src/components/InstanceSettingsAdmin.tsx` (+ test) | Admin card with the magic-link switch |
| `frontend/src/components/AuthScreen.tsx` (+ test) | Hide magic link when off; close on immediate sign-in |
| `frontend/src/contexts/AuthContext.tsx` | `signUp` reports whether it signed in right away |
| `frontend/src/App.tsx` | Fetch settings, pass them on, new Admin section |
| `docs/self-hosting.md` | The adopter's guide |
| `README.md`, `CLAUDE.md`, `.changeset/portable-instances.md` | Docs and release note |

---

### Task 1: Supabase CLI project and the baseline migration

**Files:**
- Create: `supabase/config.toml`, `supabase/.gitignore` (both from `supabase init`)
- Create: `supabase/scripts/make-baseline.sh`
- Create: `supabase/migrations/20261003000000_baseline.sql` (generated)
- Move: `supabase/migrations/*.sql` (24 files) → `supabase/archive/migrations/`

**Interfaces:**
- Produces: a CLI project whose `supabase db start` builds prod's schema from empty; container `supabase_db_toegg-elo`; local DB on port 54422.

- [ ] **Step 1: Initialise the CLI project**

From the repo root: `supabase init` (answer **N** to the VS Code / IntelliJ Deno settings prompts). Then in `supabase/config.toml`:
- set `project_id = "toegg-elo"`
- move every local port off the 543xx range another local project uses:

```bash
sed -i 's/= 543\([0-9][0-9]\)$/= 544\1/; s/^inspector_port = 8083$/inspector_port = 8183/' supabase/config.toml
grep -n "port = " supabase/config.toml   # expect 54421, 54422, 54420, 54429, 54423, 54424, 54427, 8183 ...
grep -n "major_version" supabase/config.toml   # expect 17 (prod runs 17.6)
```

- [ ] **Step 2: Archive the hand-applied migrations**

```bash
mkdir -p supabase/archive
git mv supabase/migrations supabase/archive/migrations
mkdir supabase/migrations
```

- [ ] **Step 3: Write `supabase/scripts/make-baseline.sh`**

```bash
#!/usr/bin/env bash
# Builds the baseline migration from a schema dump of prod (#56):
#
#   supabase db dump --linked -f <scratch>/prod-schema.sql        # read-only
#   supabase/scripts/make-baseline.sh <scratch>/prod-schema.sql \
#     > supabase/migrations/20261003000000_baseline.sql
#
# The dump alone doesn't rebuild prod on a fresh project, so this adds:
#  1. A REVOKE before the dump's grants. pg_dump writes grants relative to
#     Postgres' built-in defaults, but on a Supabase project the default
#     privileges have already granted every new table and function to
#     anon/authenticated/service_role by then. Without the REVOKE, functions
#     prod keeps private (link_player_account, the award helpers) come out
#     callable by anon, and the read-only tables writable.
#  2. The signup trigger on auth.users, which a public-schema dump leaves out.
#  3. A Season 1 seed for an empty league.
# The dump's ALTER DEFAULT PRIVILEGES lines are dropped: they are the
# platform's to set, and new projects deliberately stopped granting new
# tables to anon.
set -euo pipefail

dump="${1:?usage: make-baseline.sh <prod-schema.sql>}"
first=$(grep -n -m1 '^GRANT \|^REVOKE ' "$dump" | cut -d: -f1)

cat <<'EOF'
-- Baseline (#56): the schema exactly as it ran on prod on 2026-10-03. It
-- replaces the hand-applied files now in supabase/archive/migrations/.
-- Generated by supabase/scripts/make-baseline.sh from `supabase db dump`.
-- On our staging and prod it is marked applied (`supabase migration repair`),
-- never run; on a new instance it builds the whole database.

EOF
head -n "$((first - 1))" "$dump"
cat <<'EOF'
-- Start anon/authenticated/service_role from nothing, so the grants below are
-- the complete list (see supabase/scripts/make-baseline.sh).
REVOKE ALL ON ALL TABLES    IN SCHEMA "public" FROM "anon", "authenticated", "service_role";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM "anon", "authenticated", "service_role";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "public" FROM "anon", "authenticated", "service_role";

EOF
tail -n "+$first" "$dump" | grep -v '^ALTER DEFAULT PRIVILEGES'
cat <<'EOF'

-- ── Not in a public-schema dump ─────────────────────────────────────────────
-- The dump cleared search_path; handle_new_user and create_season_banner use
-- unqualified table names.
SET search_path = public, extensions;

-- Every sign-up gets a profile (role viewer).
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Seed ────────────────────────────────────────────────────────────────────
-- A fresh league starts with Season 1 running, on the defaults the new-season
-- dialog offers (K 48, partner weight 0.25); create_season_banner adds its
-- welcome banner. A no-op wherever seasons already exist.
INSERT INTO public.seasons (number, name, k_factor, partner_weight, inactivity_penalty_percent, is_active)
SELECT 1, 'Season 1', 48, 0.25, 0, true
WHERE NOT EXISTS (SELECT 1 FROM public.seasons);
EOF
```

`chmod +x supabase/scripts/make-baseline.sh` (and `git update-index --chmod=+x` on Windows).

- [ ] **Step 4: Dump prod (read-only) and generate the baseline**

Docker Desktop must be running. `SCRATCH` = the session scratchpad.

```bash
mkdir -p "$SCRATCH/prod"
supabase link --project-ref qazydxozbevggqpesnjh --workdir "$SCRATCH/prod"   # prod, in a scratch workdir - the repo stays linked to staging
supabase db dump --linked --workdir "$SCRATCH/prod" -f "$SCRATCH/prod-schema.sql"
supabase/scripts/make-baseline.sh "$SCRATCH/prod-schema.sql" > supabase/migrations/20261003000000_baseline.sql
```

Expected: a ~1800-line file; `grep -c '^GRANT' supabase/migrations/20261003000000_baseline.sql` ≈ 88; no `ALTER DEFAULT PRIVILEGES`; `on_auth_user_created` and the seed at the end. `grep -n cron supabase/migrations/20261003000000_baseline.sql` → nothing (prod has no pg_cron; verified 2026-10-03).

- [ ] **Step 5: Verify the round trip reproduces prod**

```bash
supabase db start            # empty local DB, applies supabase/migrations
supabase db dump --local -f "$SCRATCH/roundtrip.sql"
diff <(grep -v '^--\|^$' "$SCRATCH/roundtrip.sql") <(grep -v '^--\|^$' "$SCRATCH/prod-schema.sql")
```

Expected: exactly one difference, from the local image:
```
< CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";
```
Anything else (above all `GRANT ... TO "anon"` lines) means the REVOKE block is wrong - stop and fix the script.

- [ ] **Step 6: Smoke-test seed, trigger and grants**

```bash
supabase db query --local --agent no -o json "select (select count(*) from seasons where is_active) as seasons, (select count(*) from banners) as banners, has_function_privilege('anon','public.link_player_account(uuid,uuid)','execute') as anon_link, has_table_privilege('anon','public.players','select') as anon_players"
docker exec -i supabase_db_toegg-elo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/scripts/player-accounts-checks.sql
```
Expected: `seasons 1, banners 1, anon_link false, anon_players true`; the checks script exits 0 with 18 `ok` notices.

- [ ] **Step 7: Commit**

```bash
git add supabase/config.toml supabase/.gitignore supabase/scripts/make-baseline.sh supabase/migrations supabase/archive
git commit -m "ELO-56: Supabase CLI project with a baseline taken from prod

The 24 hand-applied migrations move to supabase/archive/migrations. The
baseline is prod's schema dump plus what a dump can't carry: a REVOKE so the
dumped grants are the whole list, the auth.users signup trigger and a Season 1
seed. Applied to an empty database it reproduces prod's schema exactly."
```

---

### Task 2: Database CI

**Files:**
- Modify: `supabase/scripts/season-award-voting-checks.sql:38`, `supabase/scripts/season-award-results-checks.sql:121`
- Create: `frontend/scripts/check-migrations.mjs`, `frontend/scripts/check-migrations.test.mjs`
- Create: `.github/workflows/database.yml`, `.github/workflows/workflows.yml`

**Interfaces:**
- Consumes: Task 1's CLI project (container `supabase_db_toegg-elo`).
- Produces: `checkMigrations(current: string[], released: string[]): string[]`; a CI job later tasks' SQL checks run in automatically (it runs every `supabase/scripts/*-checks.sql`).

- [ ] **Step 1: Confirm the two award checks fail on a fresh database**

```bash
for f in supabase/scripts/season-award-*-checks.sql; do docker exec -i supabase_db_toegg-elo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$f"; echo "$f rc=$?"; done
```
Expected: both fail (`FAIL rookie award refuses a veteran ...` / `FAIL rookie: votes for an ineligible nominee are dropped ...`). Cause: the "veteran" fixture writes its stats into the newest *ended* season, and a fresh league only has the running Season 1.

- [ ] **Step 2: Give both scripts their own past season**

In each file, directly above the line
`INSERT INTO player_season_stats (player_id, season_id, elo_at_start, current_season_elo, wins, losses)`
that is followed by `FROM seasons WHERE NOT is_active ORDER BY number DESC LIMIT 1;`, insert:

```sql
-- A fresh league has no ended season yet; the veteran needs one to have been
-- ranked in, or the rookie checks have nobody to refuse.
INSERT INTO seasons (number, name, started_at, ended_at, is_active)
SELECT (SELECT number FROM seasons WHERE is_active) - 1000, 'Check past season',
       now() - interval '400 days', now() - interval '300 days', false
 WHERE NOT EXISTS (SELECT 1 FROM seasons WHERE NOT is_active);
```

(The results script has that `INSERT` right after `RESET ROLE;`; insert the block between them. Negative numbers are fine: the rookie rule compares `earlier.number < current.number`, and `seasons.number` has no range check.)

Also add to each script's usage comment: `-- Locally: docker exec -i supabase_db_toegg-elo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < <this file>`.

- [ ] **Step 3: Run them again**

Same loop as Step 1. Expected: both `rc=0` (64 and 26 `ok` notices).

- [ ] **Step 4: Write the failing test for the migration-name check**

`frontend/scripts/check-migrations.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { checkMigrations } from "./check-migrations.mjs";

const BASE = "20261003000000_baseline.sql";

describe("checkMigrations", () => {
  it("accepts CLI-named migrations added after the released ones", () => {
    expect(checkMigrations([BASE, "20261004120000_add_x.sql"], [BASE])).toEqual([]);
  });

  it("ignores the pre-CLI files of an old release", () => {
    expect(
      checkMigrations([BASE], ["20260203_initial_schema.sql", "20261002_season_award_results.sql"]),
    ).toEqual([]);
  });

  it("rejects a name the CLI would not accept", () => {
    expect(checkMigrations([BASE, "20261004_add_x.sql"], [BASE])).toEqual([
      "20261004_add_x.sql: not named YYYYMMDDHHMMSS_name.sql - create migrations with `supabase migration new`",
    ]);
  });

  it("rejects a version used twice", () => {
    expect(
      checkMigrations([BASE, "20261004120000_a.sql", "20261004120000_b.sql"], [BASE]),
    ).toEqual(["20261004120000_b.sql: version 20261004120000 is already used by 20261004120000_a.sql"]);
  });

  it("rejects a new migration that sorts before a released one", () => {
    const released = [BASE, "20261010000000_b.sql"];
    expect(checkMigrations([BASE, "20261005000000_a.sql", "20261010000000_b.sql"], released)).toEqual([
      "20261005000000_a.sql: sorts before 20261010000000_b.sql, which instances may already have run - give it a newer timestamp",
    ]);
  });

  it("rejects renaming or removing a released migration", () => {
    expect(checkMigrations(["20261003000000_renamed.sql"], [BASE])).toEqual([
      "20261003000000_baseline.sql: was released, so instances have run it - never rename or remove it",
    ]);
  });
});
```

- [ ] **Step 5: Run it to see it fail**

Run: `cd frontend && pnpm vitest run scripts/check-migrations.test.mjs`
Expected: FAIL - cannot resolve `./check-migrations.mjs`.

- [ ] **Step 6: Implement `frontend/scripts/check-migrations.mjs`**

```js
// Guards supabase/migrations, which every instance's `supabase db push` reads
// (#56): file names the CLI accepts, no version used twice, no released
// migration renamed or removed, and nothing new sorting before a migration an
// instance may already have run - `db push` refuses those on every database
// that ran the later one.
//
// Usage: node frontend/scripts/check-migrations.mjs <migrations dir> [<release tag>]
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const NAME = /^\d{14}_[a-z0-9_]+\.sql$/;

/**
 * @param {string[]} current  file names in the migrations folder now
 * @param {string[]} released file names in it at the latest release
 * @returns {string[]} one message per problem; empty when all is well
 */
export function checkMigrations(current, released) {
  const problems = [];
  const named = current.filter((f) => NAME.test(f));
  for (const f of current) {
    if (!NAME.test(f)) {
      problems.push(`${f}: not named YYYYMMDDHHMMSS_name.sql - create migrations with \`supabase migration new\``);
    }
  }
  const versions = new Map();
  for (const f of named) {
    const version = f.slice(0, 14);
    if (versions.has(version)) {
      problems.push(`${f}: version ${version} is already used by ${versions.get(version)}`);
    } else {
      versions.set(version, f);
    }
  }
  // Releases before the baseline shipped hand-applied files the CLI never
  // managed; only CLI-named ones count as released.
  const shipped = released.filter((f) => NAME.test(f)).sort();
  for (const f of shipped) {
    if (!current.includes(f)) {
      problems.push(`${f}: was released, so instances have run it - never rename or remove it`);
    }
  }
  const newest = shipped.at(-1);
  if (newest) {
    for (const f of named) {
      if (!shipped.includes(f) && f < newest) {
        problems.push(`${f}: sorts before ${newest}, which instances may already have run - give it a newer timestamp`);
      }
    }
  }
  return problems;
}

function releasedFiles(tag, dir) {
  if (!tag) return [];
  try {
    return execFileSync("git", ["ls-tree", "--name-only", `${tag}:${dir}`], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    return []; // the release had no such folder
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, tag] = process.argv.slice(2);
  const current = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const problems = checkMigrations(current, releasedFiles(tag, dir));
  for (const p of problems) console.error(p);
  if (problems.length) process.exit(1);
  console.log(`${current.length} migration(s) OK${tag ? ` against ${tag}` : ""}`);
}
```

- [ ] **Step 7: Run the test and the CLI**

Run: `cd frontend && pnpm vitest run scripts/check-migrations.test.mjs` → PASS (6 tests).
Run (repo root): `node frontend/scripts/check-migrations.mjs supabase/migrations v1.13.0` → `1 migration(s) OK against v1.13.0`.

- [ ] **Step 8: Write `.github/workflows/database.yml`**

```yaml
name: Database

# Every instance applies supabase/migrations with `supabase db push` (#56), so
# a migration that only works on our databases breaks someone else's. This
# installs from empty, upgrades from the latest release, and runs the rule
# checks in supabase/scripts against the result.
on:
  push:
    branches: ["main"]
  pull_request:
    branches: ["main"]

permissions:
  contents: read

jobs:
  migrations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # the release tags

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - uses: supabase/setup-cli@v1
        with:
          version: 2.119.0

      - name: Latest release
        id: release
        run: echo "tag=$(git tag --list 'v*.*.*' --sort=-v:refname | head -1)" >> "$GITHUB_OUTPUT"

      - name: Migration names and order
        run: node frontend/scripts/check-migrations.mjs supabase/migrations "${{ steps.release.outputs.tag }}"

      # An instance one release behind, then this branch's migrations on top.
      # Skipped until a release ships CLI-managed migrations.
      - name: Upgrade from the latest release
        env:
          TAG: ${{ steps.release.outputs.tag }}
        run: |
          if [ -z "$TAG" ] || ! git ls-tree --name-only "$TAG:supabase/migrations" 2>/dev/null | grep -q '_baseline\.sql$'; then
            echo "No release with a baseline yet - nothing to upgrade from."
            exit 0
          fi
          mv supabase/migrations "$RUNNER_TEMP/branch-migrations"
          git archive "$TAG" supabase/migrations | tar -x
          supabase db start
          rm -rf supabase/migrations
          mv "$RUNNER_TEMP/branch-migrations" supabase/migrations
          supabase migration up --local
          supabase stop --no-backup

      - name: Fresh install
        run: supabase db start

      - name: Rule checks
        run: |
          for f in supabase/scripts/*-checks.sql; do
            echo "::group::$f"
            docker exec -i supabase_db_toegg-elo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$f"
            echo "::endgroup::"
          done
```

- [ ] **Step 9: Write `.github/workflows/workflows.yml`**

```yaml
name: Workflows

on:
  push:
    branches: ["main"]
  pull_request:
    branches: ["main"]

permissions:
  contents: read

jobs:
  actionlint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # The image bundles shellcheck, so the run: scripts are checked too.
      - name: actionlint
        run: docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7 -color
```

- [ ] **Step 10: Lint the workflows locally**

Run (Git Bash): `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/repo" -w /repo rhysd/actionlint:1.7.7 -color`
Expected: no output, exit 0. Fix anything reported in the new files (pre-existing findings in other workflows: fix if trivial, otherwise note them in the PR).

- [ ] **Step 11: Commit**

```bash
git add supabase/scripts/season-award-voting-checks.sql supabase/scripts/season-award-results-checks.sql frontend/scripts/check-migrations.mjs frontend/scripts/check-migrations.test.mjs .github/workflows/database.yml .github/workflows/workflows.yml
git commit -m "ELO-56: Database CI - fresh install, upgrade path, rule checks

Runs every supabase/scripts/*-checks.sql against a database built from the
migrations, and refuses migration names db push would reject. The award
checks now bring their own past season, so they pass on an empty league."
```

---

### Task 3: Close function access

**Files:**
- Create: `supabase/scripts/function-access-checks.sql`
- Create: `supabase/migrations/<ts>_close_function_access.sql` (via `supabase migration new close_function_access`)

**Interfaces:**
- Consumes: the local DB from Task 1, the CI loop from Task 2 (picks the new checks up automatically).
- Produces: the allowlist `get_my_role`, `get_players` - the only SECURITY DEFINER functions `anon` may execute. Task 4's `bootstrap_admin` must keep this check green.

- [ ] **Step 1: Write the failing checks**

`supabase/scripts/function-access-checks.sql`:

```sql
-- Who may execute the database functions (#56). The anon key ships in every
-- bundle, so anything anon can execute is a public endpoint. Runs inside a
-- transaction that is always rolled back.
-- Locally: docker exec -i supabase_db_toegg-elo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/scripts/function-access-checks.sql
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-00000000e001', 'access-user@test.invalid'),
  ('00000000-0000-4000-8000-00000000e002', 'access-admin@test.invalid');
UPDATE profiles SET role = 'user'  WHERE id = '00000000-0000-4000-8000-00000000e001';
UPDATE profiles SET role = 'admin' WHERE id = '00000000-0000-4000-8000-00000000e002';

-- act as: pass a user id, or NULL for a logged-out (anon) caller
CREATE FUNCTION pg_temp.act_as(uid UUID) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    CASE WHEN uid IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', uid, 'role', 'authenticated')::text END,
    true);
$$;

-- expect(label, sql, code): run sql, require it to fail with exactly `code`
-- (NULL = must succeed).
CREATE FUNCTION pg_temp.expect(label TEXT, stmt TEXT, code TEXT) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF code IS NULL OR SQLERRM <> code THEN
      RAISE EXCEPTION 'FAIL %: expected %, got %', label, COALESCE(code, 'success'), SQLERRM;
    END IF;
    RAISE NOTICE 'ok   %', label;
    RETURN;
  END;
  IF code IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL %: expected %, got success', label, code;
  END IF;
  RAISE NOTICE 'ok   %', label;
END;
$$;

-- Supabase's default privileges grant EXECUTE to anon on every new function,
-- so a new SECURITY DEFINER function is public until someone revokes it.
-- Only these are meant to be; anything else fails here until it is revoked
-- (REVOKE EXECUTE ... FROM PUBLIC, anon) or deliberately added to the list.
DO $$
DECLARE exposed TEXT;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1) INTO exposed
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prosecdef
     AND p.prorettype <> 'trigger'::regtype
     AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND p.proname NOT IN ('get_my_role', 'get_players');
  IF exposed IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL anon can execute SECURITY DEFINER functions: %', exposed;
  END IF;
  RAISE NOTICE 'ok   anon executes only the allowlisted definer functions';
END $$;

SET LOCAL ROLE anon;
SELECT pg_temp.act_as(NULL);
SELECT pg_temp.expect('anon cannot reorder banners', $q$SELECT set_banner_order(ARRAY[]::uuid[])$q$, 'permission denied for function set_banner_order');
SELECT pg_temp.expect('anon cannot apply penalties', $q$SELECT * FROM apply_inactivity_penalties()$q$, 'permission denied for function apply_inactivity_penalties');

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('00000000-0000-4000-8000-00000000e001');
SELECT pg_temp.expect('a user cannot reorder banners', $q$SELECT set_banner_order(ARRAY[]::uuid[])$q$, 'Only admins can reorder banners');
SELECT pg_temp.expect('a user cannot apply penalties', $q$SELECT * FROM apply_inactivity_penalties()$q$, 'permission denied for function apply_inactivity_penalties');

SELECT pg_temp.act_as('00000000-0000-4000-8000-00000000e002');
SELECT pg_temp.expect('an admin reorders banners', $q$SELECT set_banner_order(ARRAY[]::uuid[])$q$, NULL);

RESET ROLE;
SELECT pg_temp.expect('the stale increment_season_stats overload is gone',
  $q$DO $d$ BEGIN IF to_regprocedure('public.increment_season_stats(uuid,uuid,integer,boolean)') IS NOT NULL THEN RAISE EXCEPTION 'still there'; END IF; END $d$$q$, NULL);
SELECT pg_temp.expect('the one calculate-elo calls is still there',
  $q$DO $d$ BEGIN IF to_regprocedure('public.increment_season_stats(uuid,uuid,integer,integer,boolean)') IS NULL THEN RAISE EXCEPTION 'missing'; END IF; END $d$$q$, NULL);

ROLLBACK;
```

- [ ] **Step 2: Run them to see them fail**

Run: `docker exec -i supabase_db_toegg-elo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/scripts/function-access-checks.sql`
Expected: `FAIL anon can execute SECURITY DEFINER functions: apply_inactivity_penalties(), set_banner_order(uuid[])`.

- [ ] **Step 3: Create the migration**

Run: `supabase migration new close_function_access`, then fill the created file:

```sql
-- Closes the two functions the anon key could still call (#56) and drops a
-- leftover overload. Re-runnable.

-- set_banner_order: `get_my_role() <> 'admin'` is NULL for a logged-out
-- caller, which IF reads as false - so anon got through. COALESCE makes it ''.
CREATE OR REPLACE FUNCTION public.set_banner_order(p_ids uuid[]) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  AS $$
BEGIN
  IF COALESCE(get_my_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can reorder banners';
  END IF;

  UPDATE banners b
  SET sort_order = o.idx,
      updated_at = NOW()
  FROM unnest(p_ids) WITH ORDINALITY AS o(id, idx)
  WHERE b.id = o.id
    -- Skip rows already in place so an unchanged drag writes nothing.
    AND b.sort_order IS DISTINCT FROM o.idx;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_banner_order(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_banner_order(uuid[]) TO authenticated, service_role;

-- apply_inactivity_penalties has no role check, and nothing in the app calls
-- it: it was written for pg_cron, which runs as the owner. So only the owner
-- and service_role may execute it.
REVOKE EXECUTE ON FUNCTION public.apply_inactivity_penalties() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_inactivity_penalties() TO service_role;

-- 20260404_seasons_fix3 added a 5-argument increment_season_stats instead of
-- replacing the 4-argument one; calculate-elo only calls the 5-argument one.
DROP FUNCTION IF EXISTS public.increment_season_stats(uuid, uuid, integer, boolean);
```

- [ ] **Step 4: Apply and re-run the checks**

Run: `supabase migration up --local`, then the Step 2 command.
Expected: exit 0, 8 `ok` notices. Also re-run `player-accounts-checks.sql` (still 18 ok) and `node frontend/scripts/check-migrations.mjs supabase/migrations v1.13.0` (2 OK).

- [ ] **Step 5: Commit**

```bash
git add supabase/scripts/function-access-checks.sql supabase/migrations
git commit -m "ELO-56: Close set_banner_order and apply_inactivity_penalties to anon

Both were callable with the anon key. Adds an allowlist check so the next
SECURITY DEFINER function can't land as a public endpoint unnoticed, and
drops the unused 4-argument increment_season_stats."
```

---

### Task 4: Instance tables and the first-admin bootstrap

**Files:**
- Create: `supabase/scripts/instance-bootstrap-checks.sql`
- Create: `supabase/migrations/<ts>_instance_settings.sql` (via `supabase migration new instance_settings`)

**Interfaces:**
- Consumes: Task 3's allowlist (the new definer function must not be anon-executable).
- Produces (used by Tasks 6 and 7):
  - `public.app_settings(id boolean PK = true, magic_link_enabled boolean NOT NULL)` - anon/authenticated `SELECT`, admins `UPDATE (magic_link_enabled)`
  - `public.instance_state(id boolean PK = true, deployed_sha text, deployed_version text, deployed_at timestamptz, auth_configured_at timestamptz, bootstrap_admin_email text)` - no API access
  - `public.bootstrap_admin(p_email text) RETURNS text` → `'admin_exists' | 'promoted' | 'pending'`, raises `invalid_email`; owner-only

- [ ] **Step 1: Write the failing checks**

`supabase/scripts/instance-bootstrap-checks.sql`:

```sql
-- Rule checks for the instance tables and the first-admin bootstrap (#56).
-- Runs inside a transaction that is always rolled back.
-- Locally: docker exec -i supabase_db_toegg-elo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/scripts/instance-bootstrap-checks.sql
BEGIN;

-- Start from a league without an admin, whatever database this runs on.
UPDATE profiles SET role = 'viewer' WHERE role = 'admin';
UPDATE instance_state SET bootstrap_admin_email = NULL;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-00000000f001', 'boot-user@test.invalid');
UPDATE profiles SET role = 'user' WHERE id = '00000000-0000-4000-8000-00000000f001';

-- act as: pass a user id, or NULL for a logged-out (anon) caller
CREATE FUNCTION pg_temp.act_as(uid UUID) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    CASE WHEN uid IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', uid, 'role', 'authenticated')::text END,
    true);
$$;

-- expect(label, sql, code): run sql, require it to fail with exactly `code`
-- (NULL = must succeed).
CREATE FUNCTION pg_temp.expect(label TEXT, stmt TEXT, code TEXT) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF code IS NULL OR SQLERRM <> code THEN
      RAISE EXCEPTION 'FAIL %: expected %, got %', label, COALESCE(code, 'success'), SQLERRM;
    END IF;
    RAISE NOTICE 'ok   %', label;
    RETURN;
  END;
  IF code IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL %: expected %, got success', label, code;
  END IF;
  RAISE NOTICE 'ok   %', label;
END;
$$;

-- expect_value(label, query, expected): the query's single value must equal expected.
CREATE FUNCTION pg_temp.expect_value(label TEXT, query TEXT, expected TEXT) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE got TEXT;
BEGIN
  EXECUTE query INTO got;
  IF got IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL %: expected %, got %', label, COALESCE(expected, 'NULL'), COALESCE(got, 'NULL');
  END IF;
  RAISE NOTICE 'ok   %', label;
END;
$$;

-- ── Who sees what ─────────────────────────────────────────────
SELECT pg_temp.expect_value('exactly one settings row', 'SELECT count(*)::text FROM app_settings', '1');
SELECT pg_temp.expect_value('exactly one state row', 'SELECT count(*)::text FROM instance_state', '1');

SET LOCAL ROLE anon;
SELECT pg_temp.act_as(NULL);
SELECT pg_temp.expect('anon reads the settings', 'SELECT magic_link_enabled FROM app_settings', NULL);
SELECT pg_temp.expect('anon cannot change them', 'UPDATE app_settings SET magic_link_enabled = true', 'permission denied for table app_settings');
SELECT pg_temp.expect('anon cannot read instance_state', 'SELECT * FROM instance_state', 'permission denied for table instance_state');
SELECT pg_temp.expect('anon cannot bootstrap', $q$SELECT bootstrap_admin('x@test.invalid')$q$, 'permission denied for function bootstrap_admin');

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('00000000-0000-4000-8000-00000000f001');
SELECT pg_temp.expect_value('a user changes nothing',
  'WITH u AS (UPDATE app_settings SET magic_link_enabled = NOT magic_link_enabled RETURNING 1) SELECT count(*)::text FROM u', '0');
SELECT pg_temp.expect('a user cannot add a row', 'INSERT INTO app_settings (id) VALUES (false)', 'permission denied for table app_settings');
SELECT pg_temp.expect('a user cannot read instance_state', 'SELECT * FROM instance_state', 'permission denied for table instance_state');
SELECT pg_temp.expect('a user cannot bootstrap', $q$SELECT bootstrap_admin('x@test.invalid')$q$, 'permission denied for function bootstrap_admin');

-- ── bootstrap_admin, as the deploy workflow calls it (owner) ──
RESET ROLE;
SELECT pg_temp.expect('rejects a non-address', $q$SELECT bootstrap_admin('not-an-email')$q$, 'invalid_email');
SELECT pg_temp.expect_value('nobody signed up with it yet: pending', $q$SELECT bootstrap_admin('  Boss@Example.TEST ')$q$, 'pending');
SELECT pg_temp.expect_value('stored trimmed and lower-case', 'SELECT bootstrap_admin_email FROM instance_state', 'boss@example.test');

INSERT INTO auth.users (id, email) VALUES ('00000000-0000-4000-8000-00000000f002', 'someone-else@test.invalid');
SELECT pg_temp.expect_value('another sign-up stays a viewer',
  $q$SELECT role FROM profiles WHERE id = '00000000-0000-4000-8000-00000000f002'$q$, 'viewer');

INSERT INTO auth.users (id, email) VALUES ('00000000-0000-4000-8000-00000000f003', 'BOSS@example.test');
SELECT pg_temp.expect_value('the pending address signs up as admin',
  $q$SELECT role FROM profiles WHERE id = '00000000-0000-4000-8000-00000000f003'$q$, 'admin');
SELECT pg_temp.expect_value('and the pending email is cleared',
  $q$SELECT COALESCE(bootstrap_admin_email, 'none') FROM instance_state$q$, 'none');
SELECT pg_temp.expect_value('an admin exists: no-op', $q$SELECT bootstrap_admin('someone-else@test.invalid')$q$, 'admin_exists');
SELECT pg_temp.expect_value('nobody else was promoted',
  $q$SELECT role FROM profiles WHERE id = '00000000-0000-4000-8000-00000000f002'$q$, 'viewer');

-- The league lost its last admin: the next deploy promotes the existing account.
UPDATE profiles SET role = 'viewer' WHERE id = '00000000-0000-4000-8000-00000000f003';
SELECT pg_temp.expect_value('existing account: promoted', $q$SELECT bootstrap_admin('boss@example.test')$q$, 'promoted');
SELECT pg_temp.expect_value('now an admin again',
  $q$SELECT role FROM profiles WHERE id = '00000000-0000-4000-8000-00000000f003'$q$, 'admin');

-- An admin flips the switch.
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('00000000-0000-4000-8000-00000000f003');
SELECT pg_temp.expect_value('an admin changes the setting',
  'WITH u AS (UPDATE app_settings SET magic_link_enabled = NOT magic_link_enabled RETURNING 1) SELECT count(*)::text FROM u', '1');

RESET ROLE;
ROLLBACK;
```

- [ ] **Step 2: Run them to see them fail**

Run: `docker exec -i supabase_db_toegg-elo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/scripts/instance-bootstrap-checks.sql`
Expected: `ERROR: relation "instance_state" does not exist` (the script's second statement).

- [ ] **Step 3: Create the migration**

Run: `supabase migration new instance_settings`, then fill the created file:

```sql
-- Instance settings and deploy bookkeeping for self-hosted leagues (#56).
-- Re-runnable. Grants are explicit on purpose: new Supabase projects grant
-- nothing on new tables by default, older ones grant everything to anon.

-- ── app_settings: what an admin can change, readable by everyone ────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id), -- exactly one row
  magic_link_enabled boolean NOT NULL DEFAULT false
);
-- A league that already existed keeps its magic link; a fresh one starts
-- without, since it needs SMTP set up first (see docs/self-hosting.md).
INSERT INTO public.app_settings (id, magic_link_enabled)
VALUES (true, EXISTS (SELECT 1 FROM public.players))
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read app settings" ON public.app_settings;
CREATE POLICY "Anyone can read app settings" ON public.app_settings
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins can update app settings" ON public.app_settings;
CREATE POLICY "Admins can update app settings" ON public.app_settings
  FOR UPDATE TO authenticated
  USING (COALESCE(get_my_role(), '') = 'admin')
  WITH CHECK (COALESCE(get_my_role(), '') = 'admin');
REVOKE ALL ON public.app_settings FROM anon, authenticated;
GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT UPDATE (magic_link_enabled) ON public.app_settings TO authenticated;

-- ── instance_state: the deploy workflow's bookkeeping ───────────────────────
-- Read and written only by .github/workflows/deploy-instance.yml, which
-- connects as the owner. RLS on with no policies and no grants: invisible
-- through the API.
CREATE TABLE IF NOT EXISTS public.instance_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  deployed_sha text,
  deployed_version text,
  deployed_at timestamptz,
  auth_configured_at timestamptz,   -- the one-time auth setup is done
  bootstrap_admin_email text        -- ADMIN_EMAIL, until someone signs up with it
);
INSERT INTO public.instance_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.instance_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.instance_state FROM anon, authenticated;

-- ── bootstrap_admin: the deploy workflow's first-admin step ─────────────────
-- Called on every run with ADMIN_EMAIL. Does nothing while the league has an
-- admin; otherwise promotes that account, or remembers the address so
-- handle_new_user promotes it at sign-up.
CREATE OR REPLACE FUNCTION public.bootstrap_admin(p_email text) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_user uuid;
BEGIN
  IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE role = 'admin') THEN
    RETURN 'admin_exists';
  END IF;
  SELECT id INTO v_user FROM auth.users WHERE lower(email) = v_email;
  IF v_user IS NOT NULL THEN
    INSERT INTO profiles (id, email, role) VALUES (v_user, v_email, 'admin')
      ON CONFLICT (id) DO UPDATE SET role = 'admin';
    UPDATE instance_state SET bootstrap_admin_email = NULL;
    RETURN 'promoted';
  END IF;
  UPDATE instance_state SET bootstrap_admin_email = v_email;
  RETURN 'pending';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bootstrap_admin(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_admin(text) TO service_role;

-- ── handle_new_user: sign-ups are viewers, except the pending first admin ───
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  v_role text := 'viewer';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE role = 'admin')
     AND lower(NEW.email) = (SELECT bootstrap_admin_email FROM instance_state) THEN
    v_role := 'admin';
    UPDATE instance_state SET bootstrap_admin_email = NULL;
  END IF;
  INSERT INTO profiles (id, email, role) VALUES (NEW.id, NEW.email, v_role);
  RETURN NEW;
END;
$$;
```

- [ ] **Step 4: Apply and re-run all checks**

```bash
supabase migration up --local
for f in supabase/scripts/*-checks.sql; do docker exec -i supabase_db_toegg-elo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$f" || echo "FAILED: $f"; done
```
Expected: no `FAILED` line; `instance-bootstrap-checks.sql` prints 21 `ok`; `function-access-checks.sql` still passes (bootstrap_admin is not anon-executable).

- [ ] **Step 5: Check a fresh install starts with the magic link off**

```bash
supabase db reset --local
supabase db query --local --agent no -o json "select magic_link_enabled from app_settings"
```
Expected: `[{"magic_link_enabled": false}]` (no players in a fresh league).

- [ ] **Step 6: Commit**

```bash
git add supabase/scripts/instance-bootstrap-checks.sql supabase/migrations
git commit -m "ELO-56: app_settings, instance_state and the first-admin bootstrap

app_settings holds the magic-link switch (readable by everyone, admins
update). instance_state is the deploy workflow's private bookkeeping.
bootstrap_admin(ADMIN_EMAIL) promotes that account, or handle_new_user does
at sign-up - only while the league has no admin."
```

---

### Task 5: calculate-elo on new Supabase projects

**Files:**
- Create: `supabase/functions/calculate-elo/keys.ts`, `supabase/functions/calculate-elo/keys_test.ts`
- Modify: `supabase/functions/calculate-elo/index.ts:143-150`
- Modify: `supabase/config.toml` (add a `[functions.calculate-elo]` section)

**Interfaces:**
- Produces: `serviceKey(env: (name: string) => string | undefined): string`.

- [ ] **Step 1: Write the failing tests**

`supabase/functions/calculate-elo/keys_test.ts`:

```ts
import { assertEquals, assertThrows } from "@std/assert";
import { serviceKey } from "./keys.ts";

const env = (vars: Record<string, string>) => (name: string) => vars[name];

Deno.test("keys: a new project's default secret key", () => {
  assertEquals(serviceKey(env({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_new"}' })), "sb_secret_new");
});

Deno.test("keys: the secret key wins over a legacy service_role key", () => {
  assertEquals(
    serviceKey(env({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_new"}', SUPABASE_SERVICE_ROLE_KEY: "legacy-jwt" })),
    "sb_secret_new",
  );
});

Deno.test("keys: a secret key under another name", () => {
  assertEquals(serviceKey(env({ SUPABASE_SECRET_KEYS: '{"ci":"sb_secret_ci"}' })), "sb_secret_ci");
});

Deno.test("keys: an older project's service_role key", () => {
  assertEquals(serviceKey(env({ SUPABASE_SERVICE_ROLE_KEY: "legacy-jwt" })), "legacy-jwt");
});

Deno.test("keys: malformed SUPABASE_SECRET_KEYS falls back to the legacy key", () => {
  assertEquals(serviceKey(env({ SUPABASE_SECRET_KEYS: "not json", SUPABASE_SERVICE_ROLE_KEY: "legacy-jwt" })), "legacy-jwt");
});

Deno.test("keys: no key at all is an error", () => {
  assertThrows(() => serviceKey(env({})), Error, "Missing Supabase environment variables");
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd supabase/functions/calculate-elo && deno test -A keys_test.ts`
Expected: FAIL - module `./keys.ts` not found.

- [ ] **Step 3: Implement `supabase/functions/calculate-elo/keys.ts`**

```ts
/**
 * The key calculate-elo writes with.
 *
 * Supabase projects created since late 2025 have no legacy service_role key:
 * the runtime injects their secret keys as SUPABASE_SECRET_KEYS, a JSON object
 * keyed by name ("default" is the one a project starts with). Older projects -
 * ours - have SUPABASE_SERVICE_ROLE_KEY. Prefer the new kind, fall back to the
 * old, so the same function runs on every instance.
 *
 * Kept free of Supabase imports so it can be tested without a runtime.
 */
export function serviceKey(env: (name: string) => string | undefined): string {
  const secrets = env("SUPABASE_SECRET_KEYS");
  if (secrets) {
    try {
      const keys = JSON.parse(secrets) as Record<string, unknown>;
      const key = keys["default"] ?? Object.values(keys).find((v) => typeof v === "string");
      if (typeof key === "string" && key) return key;
    } catch {
      // Malformed: fall through to the legacy key rather than fail outright.
    }
  }
  const legacy = env("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  throw new Error("Missing Supabase environment variables");
}
```

- [ ] **Step 4: Use it in `index.ts`**

Add `import { serviceKey } from "./keys.ts";` next to the `./auth.ts` import, and replace

```ts
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase environment variables");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
```

with

```ts
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) {
      throw new Error("Missing Supabase environment variables");
    }

    const supabase = createClient(supabaseUrl, serviceKey((name) => Deno.env.get(name)));
```

- [ ] **Step 5: Turn off the platform JWT gate in `supabase/config.toml`**

Append:

```toml
# calculate-elo authorizes every caller itself (auth.ts: the Auth server
# resolves the session token, then the profile role must be user/admin). The
# platform's verify_jwt gate added nothing - it accepted the anon key - and it
# can't verify tokens on projects using the new API keys, so it is off.
[functions.calculate-elo]
verify_jwt = false
```

- [ ] **Step 6: Run lint, typecheck and the whole suite**

Run (in `supabase/functions/calculate-elo`): `deno lint && deno check index.ts && deno test -A`
Expected: lint clean, check OK, all tests pass (70 existing + 6 new).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/calculate-elo/keys.ts supabase/functions/calculate-elo/keys_test.ts supabase/functions/calculate-elo/index.ts supabase/config.toml
git commit -m "ELO-56: calculate-elo runs on projects without legacy keys

New Supabase projects only have publishable/secret keys. The function now
takes SUPABASE_SECRET_KEYS and falls back to SUPABASE_SERVICE_ROLE_KEY, and
is deployed with verify_jwt off - its own auth check is the gate."
```

---

### Task 6: Frontend - the magic-link switch

**Files:**
- Modify: `frontend/src/lib/supabase.ts` (new block after the banners section, ~line 750)
- Modify: `frontend/src/contexts/AuthContext.tsx:15,62-65`
- Modify: `frontend/src/components/AuthScreen.tsx`
- Create: `frontend/src/components/AuthScreen.test.tsx`
- Create: `frontend/src/components/InstanceSettingsAdmin.tsx`, `frontend/src/components/InstanceSettingsAdmin.test.tsx`
- Modify: `frontend/src/App.tsx` (AppData, fetchAppData, ADMIN_SECTIONS, Admin tab, AuthScreen)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/de.json`
- Create: `.changeset/portable-instances.md`

**Interfaces:**
- Consumes: Task 4's `app_settings` table.
- Produces: `type AppSettings = { magic_link_enabled: boolean }`, `DEFAULT_APP_SETTINGS`, `getAppSettings(): Promise<AppSettings>`, `updateAppSettings(patch: Partial<AppSettings>): Promise<void>`; `AuthScreen` prop `magicLinkEnabled?: boolean`; `useAuth().signUp(email, password): Promise<boolean>` (true = signed in right away).

- [ ] **Step 1: Add the strings**

`en.json` - add a top-level `"instanceSettings"` object:

```json
"instanceSettings": {
  "title": "Instance settings",
  "hint": "Settings for this TöggElo instance.",
  "magicLink": "Sign in with a magic link",
  "magicLinkHint": "Only switch this on once custom SMTP is set up in Supabase (Authentication → Emails). Without it, the links never arrive.",
  "on": "On",
  "off": "Off",
  "saveFailed": "Could not save the setting."
}
```

`de.json`:

```json
"instanceSettings": {
  "title": "Instanz-Einstellungen",
  "hint": "Einstellungen für diese TöggElo-Instanz.",
  "magicLink": "Anmeldung per Magic Link",
  "magicLinkHint": "Erst einschalten, wenn in Supabase ein eigener SMTP-Server eingerichtet ist (Authentication → Emails). Sonst kommen die Links nie an.",
  "on": "Ein",
  "off": "Aus",
  "saveFailed": "Die Einstellung konnte nicht gespeichert werden."
}
```

- [ ] **Step 2: Write the failing AuthScreen tests**

`frontend/src/components/AuthScreen.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthScreen } from "./AuthScreen";

const auth = {
  signIn: vi.fn(),
  signInWithMagicLink: vi.fn(),
  signUp: vi.fn(),
};
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => auth }));

beforeEach(() => vi.clearAllMocks());

const signUpAs = async (container: HTMLElement) => {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Sign up" })); // switch to sign-up
  await user.type(container.querySelector<HTMLInputElement>('input[type="email"]')!, "new@test.invalid");
  await user.type(container.querySelector<HTMLInputElement>('input[type="password"]')!, "secret123");
  await user.click(screen.getByRole("button", { name: "Sign up" })); // submit
};

describe("AuthScreen", () => {
  it("offers the magic link when it is switched on", () => {
    render(<AuthScreen magicLinkEnabled />);
    expect(screen.getByRole("button", { name: "Magic link" })).toBeInTheDocument();
  });

  it("is password-only when the magic link is off", () => {
    const { container } = render(<AuthScreen magicLinkEnabled={false} />);
    expect(screen.queryByRole("button", { name: "Magic link" })).not.toBeInTheDocument();
    expect(container.querySelector('input[type="password"]')).toBeRequired();
  });

  it("closes once a sign-up is signed in right away (no email confirmation)", async () => {
    auth.signUp.mockResolvedValue(true);
    const onClose = vi.fn();
    const { container } = render(<AuthScreen magicLinkEnabled={false} onClose={onClose} />);
    await signUpAs(container);
    expect(auth.signUp).toHaveBeenCalledWith("new@test.invalid", "secret123");
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByText(/Check your email to confirm/)).not.toBeInTheDocument();
  });

  it("asks to confirm the address when the instance requires it", async () => {
    auth.signUp.mockResolvedValue(false);
    const onClose = vi.fn();
    const { container } = render(<AuthScreen magicLinkEnabled onClose={onClose} />);
    await signUpAs(container);
    expect(screen.getByText(/Check your email to confirm/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd frontend && pnpm vitest run src/components/AuthScreen.test.tsx`
Expected: "is password-only" fails (Magic link button present) and "closes once..." fails (shows the confirmation text, `onClose` not called).

- [ ] **Step 4: `signUp` reports whether it signed in**

`AuthContext.tsx` - in the type: `signUp: (email: string, password: string) => Promise<boolean>;` with the doc comment `/** True when the account is signed in right away (instances without email confirmation). */`, and:

```tsx
  const signUp = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    // Without email confirmation (fresh instances, #56) Supabase signs the new
    // account in immediately; otherwise there is no session until the link.
    return data.session !== null;
  };
```

- [ ] **Step 5: AuthScreen follows the switch**

In `AuthScreen.tsx`:
- signature: `export function AuthScreen({ onClose, magicLinkEnabled = true }: { onClose?: () => void; magicLinkEnabled?: boolean })`
- right after the `useState` hooks: 
```tsx
  // With the magic link off (#56: it needs SMTP), a previously chosen
  // "magic" method falls back to password.
  const method = magicLinkEnabled ? loginMethod : "password";
```
- replace every *read* of `loginMethod` in `handleSubmit` and in the JSX (`loginMethod === "magic"`, `loginMethod === "password"`, `data-method={loginMethod}`) with `method`; the `setLoginMethod(...)` calls stay.
- the toggle renders only when allowed: `{mode === "login" && magicLinkEnabled && (` … `)}`
- in `handleSubmit`, the sign-up branch:
```tsx
      } else {
        const signedIn = await signUp(email, password);
        if (signedIn) onClose?.();
        else setSignedUp(true);
      }
```

- [ ] **Step 6: Run the AuthScreen tests**

Run: `cd frontend && pnpm vitest run src/components/AuthScreen.test.tsx` → PASS (4 tests).

- [ ] **Step 7: Settings access in `supabase.ts`**

Add after the banner functions:

```ts
// ── App settings (#56) ──────────────────────────────────────────────────────

/** An instance's admin-editable settings: the one row in `app_settings`. */
export type AppSettings = { magic_link_enabled: boolean };

/** What the app does without the row - before the migration reached this
 *  database, or when the read fails: what it always did, magic link offered. */
export const DEFAULT_APP_SETTINGS: AppSettings = { magic_link_enabled: true };

export async function getAppSettings(): Promise<AppSettings> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("magic_link_enabled")
    .maybeSingle();
  if (error) console.warn("Could not load app settings:", error.message);
  return (data as AppSettings | null) ?? DEFAULT_APP_SETTINGS;
}

export async function updateAppSettings(patch: Partial<AppSettings>): Promise<void> {
  const { data, error } = await supabase
    .from("app_settings")
    .update(patch)
    .eq("id", true)
    .select("magic_link_enabled");
  if (error) throw error;
  // RLS turns a refused update into "no rows", not an error.
  if (!data?.length) throw new Error("not_allowed");
}
```

- [ ] **Step 8: Write the failing InstanceSettingsAdmin tests**

`frontend/src/components/InstanceSettingsAdmin.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstanceSettingsAdmin } from "./InstanceSettingsAdmin";
import { updateAppSettings } from "../lib/supabase";

vi.mock("../lib/supabase", () => ({ updateAppSettings: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("InstanceSettingsAdmin", () => {
  it("shows whether the magic link is on", () => {
    render(<InstanceSettingsAdmin settings={{ magic_link_enabled: false }} onChanged={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "On" })).toHaveAttribute("aria-pressed", "false");
  });

  it("switches it on and refetches", async () => {
    vi.mocked(updateAppSettings).mockResolvedValue();
    const onChanged = vi.fn();
    render(<InstanceSettingsAdmin settings={{ magic_link_enabled: false }} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole("button", { name: "On" }));
    expect(updateAppSettings).toHaveBeenCalledWith({ magic_link_enabled: true });
    expect(onChanged).toHaveBeenCalled();
  });

  it("says so when the save is refused", async () => {
    vi.mocked(updateAppSettings).mockRejectedValue(new Error("not_allowed"));
    const onChanged = vi.fn();
    render(<InstanceSettingsAdmin settings={{ magic_link_enabled: false }} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole("button", { name: "On" }));
    expect(await screen.findByText("Could not save the setting.")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("does nothing when the current state is clicked", async () => {
    render(<InstanceSettingsAdmin settings={{ magic_link_enabled: true }} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "On" }));
    expect(updateAppSettings).not.toHaveBeenCalled();
  });
});
```

Run: `cd frontend && pnpm vitest run src/components/InstanceSettingsAdmin.test.tsx` → FAIL (module not found).

- [ ] **Step 9: Implement `InstanceSettingsAdmin.tsx`**

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { updateAppSettings, type AppSettings } from "../lib/supabase";

interface InstanceSettingsAdminProps {
  settings: AppSettings;
  /** Refetch after a change, so the login screen follows. */
  onChanged: () => void;
}

/**
 * The Admin tab's "Instance settings" card (#56): what an office running its
 * own instance can change. For now only the magic link, which needs custom
 * SMTP in Supabase before it can deliver anything.
 */
export function InstanceSettingsAdmin({ settings, onChanged }: InstanceSettingsAdminProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setMagicLink = async (enabled: boolean) => {
    if (enabled === settings.magic_link_enabled) return;
    setSaving(true);
    setError(null);
    try {
      await updateAppSettings({ magic_link_enabled: enabled });
      onChanged();
    } catch {
      setError(t("instanceSettings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card mt-6">
      <h2>{t("instanceSettings.title")}</h2>
      <p className="text-text-light text-[0.85rem] mt-1 mb-4">{t("instanceSettings.hint")}</p>
      <div className="form-group">
        <span className="block font-medium mb-2">{t("instanceSettings.magicLink")}</span>
        <div className="lb-toggle w-fit" role="group" aria-label={t("instanceSettings.magicLink")}>
          {[true, false].map((on) => (
            <button
              key={String(on)}
              type="button"
              className={`lb-toggle-btn${settings.magic_link_enabled === on ? " active" : ""}`}
              aria-pressed={settings.magic_link_enabled === on}
              onClick={() => setMagicLink(on)}
              disabled={saving}
            >
              {t(on ? "instanceSettings.on" : "instanceSettings.off")}
            </button>
          ))}
        </div>
        <span className="block text-[0.78rem] text-text-light mt-1">
          {t("instanceSettings.magicLinkHint")}
        </span>
      </div>
      {error && (
        <div className="bg-error-light text-error px-4 py-3 rounded-md text-sm border-l-4 border-error mt-4">
          {error}
        </div>
      )}
    </div>
  );
}
```

Run the test file again → PASS (4 tests).

- [ ] **Step 10: Wire it into `App.tsx`**

- import `InstanceSettingsAdmin` next to `SeasonOptionsAdmin`; import `getAppSettings`, `DEFAULT_APP_SETTINGS`, `type AppSettings` from `./lib/supabase` (with the other supabase imports)
- `interface AppData`: add `appSettings: AppSettings;`
- `fetchAppData`: add `appSettings` to the destructured `Promise.all` result and `getAppSettings()` as the last entry of the array (it never throws), and `appSettings` to the returned object
- `ADMIN_SECTIONS`: append `{ id: "admin-instance", labelKey: "instanceSettings.title" },`
- next to the other `data?.… ?? EMPTY_…` reads: `const appSettings = data?.appSettings ?? DEFAULT_APP_SETTINGS;`
- in the Admin tab, after the `admin-banners` section:
```tsx
              <section id="admin-instance" tabIndex={-1} className="nav-section">
                <InstanceSettingsAdmin settings={appSettings} onChanged={refresh} />
              </section>
```
- the dialog: `{authOpen && <AuthScreen onClose={() => setAuthOpen(false)} magicLinkEnabled={appSettings.magic_link_enabled} />}`

- [ ] **Step 11: Changeset**

`.changeset/portable-instances.md`:

```md
---
"toegg-elo-frontend": minor
---

Other offices can run their own TöggElo, kept up to date automatically; admins can switch the magic-link login on or off

Self-hosting guide: docs/self-hosting.md. Database is now CLI-managed (baseline + `supabase db push`), with CI that installs from empty, upgrades from the last release and runs the SQL rule checks. set_banner_order and apply_inactivity_penalties are no longer callable with the anon key. calculate-elo also runs on projects without legacy keys.
```

- [ ] **Step 12: Full frontend check**

Run: `cd frontend && pnpm lint && pnpm test && pnpm exec tsc --noEmit`
Expected: lint clean, all tests pass; `tsc` shows only the known pre-existing `Leaderboard.tsx` errors, none in the touched files.

- [ ] **Step 13: Commit**

```bash
git add frontend/src .changeset/portable-instances.md
git commit -m "ELO-56: Magic-link switch under Admin → Instance settings

The login screen is password-only while it is off (a fresh instance has no
SMTP). A sign-up that is signed in right away - instances without email
confirmation - closes the dialog instead of asking to confirm the address."
```

---

### Task 7: The deploy pipeline

**Files:**
- Create: `frontend/scripts/instance-deploy.mjs`, `frontend/scripts/instance-deploy.test.mjs`
- Create: `.github/workflows/deploy-instance.yml`, `instance/deploy.yml`
- Modify: `.github/workflows/release.yml` (end of the "Tag and create the GitHub Release" step)

**Interfaces:**
- Consumes: `instance_state` columns and `bootstrap_admin(text)` (Task 4); `[functions.calculate-elo] verify_jwt = false` (Task 5).
- Produces: `planRun(checkoutSha: string, state: null | {deployed_sha: string | null, auth_configured_at: string | null}): {deploy: boolean, configureAuth: boolean}`; `browserKey(keys: {type: string, name: string, api_key: string | null}[]): string`; the reusable workflow's inputs `supabase_project_ref`, `site_url`, `vercel_project`, `vercel_team_id`, `ref` and secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `VERCEL_TOKEN`, `ADMIN_EMAIL` (Task 8's guide documents exactly these).

- [ ] **Step 1: Write the failing tests**

`frontend/scripts/instance-deploy.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { browserKey, planRun } from "./instance-deploy.mjs";

const DONE = "2026-10-03T10:00:00Z";

describe("planRun", () => {
  it("first install: deploy and set up auth", () => {
    expect(planRun("abc", null)).toEqual({ deploy: true, configureAuth: true });
  });

  it("up to date: nothing to do", () => {
    expect(planRun("abc", { deployed_sha: "abc", auth_configured_at: DONE })).toEqual({
      deploy: false,
      configureAuth: false,
    });
  });

  it("a new release: deploy, leave auth alone", () => {
    expect(planRun("def", { deployed_sha: "abc", auth_configured_at: DONE })).toEqual({
      deploy: true,
      configureAuth: false,
    });
  });

  it("a retry after a failed deploy never redoes the auth setup", () => {
    expect(planRun("abc", { deployed_sha: null, auth_configured_at: DONE })).toEqual({
      deploy: true,
      configureAuth: false,
    });
  });

  it("an auth setup that failed last time is retried", () => {
    expect(planRun("abc", { deployed_sha: null, auth_configured_at: null })).toEqual({
      deploy: true,
      configureAuth: true,
    });
  });
});

describe("browserKey", () => {
  const anon = { type: "legacy", name: "anon", api_key: "anon-jwt" };
  const serviceRole = { type: "legacy", name: "service_role", api_key: "service-jwt" };
  const publishable = { type: "publishable", name: "default", api_key: "sb_publishable_x" };
  const secret = { type: "secret", name: "default", api_key: "sb_secret_x" };

  it("a new project's publishable key", () => {
    expect(browserKey([secret, publishable])).toBe("sb_publishable_x");
  });

  it("prefers the publishable key over the legacy anon key", () => {
    expect(browserKey([anon, serviceRole, publishable])).toBe("sb_publishable_x");
  });

  it("an older project's anon key", () => {
    expect(browserKey([serviceRole, anon])).toBe("anon-jwt");
  });

  it("never a secret or service_role key", () => {
    expect(() => browserKey([secret, serviceRole])).toThrow("No publishable or anon key found");
  });
});
```

Run: `cd frontend && pnpm vitest run scripts/instance-deploy.test.mjs` → FAIL (module not found).

- [ ] **Step 2: Implement `frontend/scripts/instance-deploy.mjs`**

```js
// Decisions the deploy-instance workflow makes (#56), kept out of its YAML so
// they can be tested: whether a run has anything to deploy, whether the
// one-time auth setup is still due, and which API key the browser gets.
//
// Usage (from .github/workflows/deploy-instance.yml):
//   node frontend/scripts/instance-deploy.mjs plan <checkout sha> <state.json | absent>
//     prints deploy=… and configure_auth=… lines for $GITHUB_OUTPUT
//   node frontend/scripts/instance-deploy.mjs browser-key <api-keys.json>
//     prints the key the frontend is built with
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * @param {string} checkoutSha the commit this run would deploy
 * @param {null | {deployed_sha: string | null, auth_configured_at: string | null}} state
 *   the instance_state row; null before the first install created the table
 */
export function planRun(checkoutSha, state) {
  return {
    deploy: state === null || state.deployed_sha !== checkoutSha,
    // Only ever once: afterwards the auth settings belong to the adopter
    // (SMTP, a custom domain), and no later run may overwrite them - not even
    // a retry after a failed deploy, which is why this isn't tied to `deploy`.
    configureAuth: state === null || state.auth_configured_at === null,
  };
}

/**
 * The key the frontend bundle ships with: the publishable key new projects
 * have, else the legacy anon key older ones have. Never a secret key.
 * @param {{type: string, name: string, api_key: string | null}[]} keys
 *   the Management API's GET /v1/projects/{ref}/api-keys
 */
export function browserKey(keys) {
  const pick =
    keys.find((k) => k.type === "publishable") ??
    keys.find((k) => k.type === "legacy" && k.name === "anon");
  if (!pick?.api_key) throw new Error("No publishable or anon key found for this project");
  return pick.api_key;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "plan") {
    const [sha, stateFile] = args;
    // `supabase db query -o json` prints the rows as a JSON array.
    const state = stateFile === "absent" ? null : (JSON.parse(readFileSync(stateFile, "utf8"))[0] ?? null);
    const { deploy, configureAuth } = planRun(sha, state);
    console.log(`deploy=${deploy}\nconfigure_auth=${configureAuth}`);
  } else if (command === "browser-key") {
    console.log(browserKey(JSON.parse(readFileSync(args[0], "utf8"))));
  } else {
    console.error("usage: instance-deploy.mjs plan <sha> <state.json|absent> | browser-key <api-keys.json>");
    process.exit(2);
  }
}
```

Run the test file → PASS (9 tests).

- [ ] **Step 3: Write `.github/workflows/deploy-instance.yml`**

```yaml
name: Deploy instance

# Deploys TöggElo to an adopting office's own Supabase and Vercel projects
# (#56), called from their repository by instance/deploy.yml - daily and on
# demand. Everything runs with their secrets on their accounts. Each step is
# idempotent and the deployed commit is recorded last, so a failed run is
# simply retried by the next one.
on:
  workflow_call:
    inputs:
      supabase_project_ref:
        description: The instance's Supabase project ref.
        type: string
        required: true
      site_url:
        description: The instance's public URL, e.g. https://acme-toeggelo.vercel.app
        type: string
        required: true
      vercel_project:
        description: The Vercel project to publish to; created if it doesn't exist.
        type: string
        required: true
      vercel_team_id:
        description: The Vercel team owning the project; empty for the token's own account.
        type: string
        default: ""
      ref:
        description: Deploy this branch/tag/SHA instead of the release track. Testing only.
        type: string
        default: ""
    secrets:
      SUPABASE_ACCESS_TOKEN:
        required: true
      SUPABASE_DB_PASSWORD:
        required: true
      VERCEL_TOKEN:
        required: true
      ADMIN_EMAIL:
        required: true

env:
  # The release track this copy of the file deploys. The PR that releases 2.0
  # bumps it to v2, so the file at the v2 tag deploys v2 and v1 stays on 1.x.
  TRACK: v1

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
      PROJECT_REF: ${{ inputs.supabase_project_ref }}
      HUSKY: "0"
    steps:
      - name: Check out TöggElo
        uses: actions/checkout@v4
        with:
          # Inside a called workflow, checkout defaults to the caller's repo.
          repository: miltronius/toegg-elo
          ref: ${{ inputs.ref || env.TRACK }}

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - uses: supabase/setup-cli@v1
        with:
          version: 2.119.0

      - name: Link the Supabase project
        run: supabase link --project-ref "$PROJECT_REF"

      - name: Compare with what is deployed
        id: plan
        run: |
          present=$(supabase db query --linked --agent no -o json \
            "select to_regclass('public.instance_state') is not null as present" | jq -r '.[0].present')
          if [ "$present" = "true" ]; then
            supabase db query --linked --agent no -o json \
              "select deployed_sha, auth_configured_at from instance_state" > "$RUNNER_TEMP/state.json"
            state="$RUNNER_TEMP/state.json"
          else
            state=absent
          fi
          sha=$(git rev-parse HEAD)
          node frontend/scripts/instance-deploy.mjs plan "$sha" "$state" >> "$GITHUB_OUTPUT"
          echo "sha=$sha" >> "$GITHUB_OUTPUT"
          echo "version=$(node -p "require('./frontend/package.json').version")" >> "$GITHUB_OUTPUT"

      - name: Up to date
        if: steps.plan.outputs.deploy == 'false'
        run: echo "v${{ steps.plan.outputs.version }} (${{ steps.plan.outputs.sha }}) is already deployed."

      - name: Apply database migrations
        if: steps.plan.outputs.deploy == 'true'
        run: supabase db push --linked --yes

      - name: Set up sign-in (first install only)
        if: steps.plan.outputs.deploy == 'true' && steps.plan.outputs.configure_auth == 'true'
        env:
          SITE_URL: ${{ inputs.site_url }}
        run: |
          site="${SITE_URL%/}"
          jq -n --arg site "$site" \
            '{site_url: $site, uri_allow_list: ($site + "/**"), mailer_autoconfirm: true}' |
            curl -fsS -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
              -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
              -H "Content-Type: application/json" --data @- > /dev/null
          supabase db query --linked --agent no "update instance_state set auth_configured_at = now()"

      - name: Deploy the calculate-elo function
        if: steps.plan.outputs.deploy == 'true'
        run: supabase functions deploy calculate-elo --project-ref "$PROJECT_REF" --use-api

      # Every run, not only on a deploy: a league that lost its last admin gets
      # one back the next day. A no-op while any admin exists.
      - name: First admin
        env:
          ADMIN_EMAIL: ${{ secrets.ADMIN_EMAIL }}
        run: |
          email=${ADMIN_EMAIL//\'/\'\'}   # as an SQL literal
          supabase db query --linked --agent no -o json \
            "select bootstrap_admin('$email') as result" | jq -r '"First admin: " + .[0].result'

      - uses: pnpm/action-setup@v4
        if: steps.plan.outputs.deploy == 'true'
        with:
          version: 10
          run_install: false

      - name: Build the frontend
        if: steps.plan.outputs.deploy == 'true'
        run: |
          curl -fsS "https://api.supabase.com/v1/projects/$PROJECT_REF/api-keys" \
            -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" > "$RUNNER_TEMP/api-keys.json"
          key=$(node frontend/scripts/instance-deploy.mjs browser-key "$RUNNER_TEMP/api-keys.json")
          pnpm install --frozen-lockfile
          VITE_SUPABASE_URL="https://$PROJECT_REF.supabase.co" VITE_SUPABASE_ANON_KEY="$key" \
            pnpm --filter toegg-elo-frontend build
          # Vercel's Build Output API: for a static site, just these two.
          mkdir -p .vercel/output/static
          cp -r frontend/dist/. .vercel/output/static/
          echo '{"version":3}' > .vercel/output/config.json

      - name: Publish to Vercel
        if: steps.plan.outputs.deploy == 'true'
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          VERCEL_PROJECT: ${{ inputs.vercel_project }}
          VERCEL_TEAM_ID: ${{ inputs.vercel_team_id }}
        run: |
          api=https://api.vercel.com
          scope=${VERCEL_TEAM_ID:+?teamId=$VERCEL_TEAM_ID}
          # Find the project, or create it here: the dashboard only creates
          # projects connected to a Git repository, and the instance repository
          # has nothing to build.
          if ! project=$(curl -fsS -H "Authorization: Bearer $VERCEL_TOKEN" "$api/v9/projects/$VERCEL_PROJECT$scope"); then
            project=$(jq -n --arg name "$VERCEL_PROJECT" '{name: $name}' |
              curl -fsS -X POST -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
                --data @- "$api/v11/projects$scope")
          fi
          VERCEL_ORG_ID=$(jq -r .accountId <<<"$project")
          VERCEL_PROJECT_ID=$(jq -r .id <<<"$project")
          export VERCEL_ORG_ID VERCEL_PROJECT_ID
          npx --yes vercel@62 deploy --prebuilt --prod --yes --token "$VERCEL_TOKEN"

      - name: Record the deployed version
        if: steps.plan.outputs.deploy == 'true'
        run: |
          supabase db query --linked --agent no \
            "update instance_state set deployed_sha = '${{ steps.plan.outputs.sha }}', deployed_version = '${{ steps.plan.outputs.version }}', deployed_at = now()"
```

Before relying on the Vercel endpoints, check them against the API reference (`GET /v9/projects/{idOrName}` "Find a project by id or name", `POST /v11/projects` "Create a new project", both with `teamId`) and adjust the versions if they moved.

- [ ] **Step 4: Write `instance/deploy.yml`**

```yaml
# TöggElo for your office: deploys github.com/miltronius/toegg-elo to your own
# Supabase and Vercel projects, and keeps it up to date - every day it picks
# up the newest 1.x release. Setup: docs/self-hosting.md in that repository.
#
# Copy this file to .github/workflows/deploy.yml in your (private) repository.
# You never need to edit it, except to move to a new major version: change
# @v1 below to @v2 once its release notes say so.
name: Deploy TöggElo

on:
  schedule:
    - cron: "23 3 * * *" # daily, 03:23 UTC
  workflow_dispatch: # Actions → Deploy TöggElo → Run workflow = update now

concurrency:
  group: deploy-toegg-elo
  cancel-in-progress: false

jobs:
  deploy:
    uses: miltronius/toegg-elo/.github/workflows/deploy-instance.yml@v1
    with:
      supabase_project_ref: ${{ vars.SUPABASE_PROJECT_REF }}
      site_url: ${{ vars.SITE_URL }}
      vercel_project: ${{ vars.VERCEL_PROJECT }}
      vercel_team_id: ${{ vars.VERCEL_TEAM_ID }}
    # Passed one by one: `secrets: inherit` only works within one organization.
    secrets:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
      VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
      ADMIN_EMAIL: ${{ secrets.ADMIN_EMAIL }}
```

- [ ] **Step 5: Move the major tag on every release**

In `.github/workflows/release.yml`, at the end of the `run:` of "Tag and create the GitHub Release", after `gh release create ...`:

```bash
          # The release track instances follow (deploy-instance.yml's TRACK):
          # v1 always points at the newest 1.x.y.
          major="v${version%%.*}"
          git tag -f "$major" "$GITHUB_SHA"
          git push -f origin "refs/tags/$major"
```

(The step's early `exit 0`s mean this only runs when a new release was just created.)

- [ ] **Step 6: Lint**

Run: `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/repo" -w /repo rhysd/actionlint:1.7.7 -color` and `cd frontend && pnpm vitest run scripts/` → both clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/scripts/instance-deploy.mjs frontend/scripts/instance-deploy.test.mjs .github/workflows/deploy-instance.yml .github/workflows/release.yml instance/deploy.yml
git commit -m "ELO-56: Reusable deploy workflow for self-hosted instances

An instance's repository calls deploy-instance.yml@v1 daily: migrations,
first-install auth setup, calculate-elo, first admin, frontend to Vercel,
then the deployed commit is recorded. Releases now move the v1 tag."
```

---

### Task 8: Docs

**Files:**
- Create: `docs/self-hosting.md`
- Modify: `README.md` (feature intro, "Elo Calculation", "Supabase Setup & Deployment", "Deployment")
- Modify: `CLAUDE.md` (several sections, listed below)

**Interfaces:**
- Consumes: Task 7's input/secret names (must match exactly), Task 4's `bootstrap_admin` semantics, Task 6's Admin card name.

- [ ] **Step 1: Write `docs/self-hosting.md`**

```markdown
# Run TöggElo for your office

TöggElo tracks 2v2 foosball matches and ranks players with Elo. You can run your
own copy for your office: your data stays in **your** accounts, and new versions
arrive by themselves - every day your copy picks up the newest 1.x release from
[github.com/miltronius/toegg-elo](https://github.com/miltronius/toegg-elo).

It takes about 20 minutes and three free accounts.

## What you need

| Account | Used for | Plan |
|---|---|---|
| [GitHub](https://github.com) | A small private repository that runs the updates | Free |
| [Supabase](https://supabase.com) | Database, sign-in, the Elo calculation | Free (two active projects per account) |
| [Vercel](https://vercel.com) | The website | Hobby is free for non-commercial use - check whether your company needs Pro |

## 1. Supabase

1. Create a project. Pick a region near your office and **save the database password**.
2. Note the **project ref**: Project Settings → General (also the `xxxx` in `https://xxxx.supabase.co`).
3. Create an **access token**: Account → Access Tokens → Generate new token.

## 2. Vercel

1. Create a **token**: Account Settings → Tokens. If you work in a team, scope it to that team and note the **Team ID** (Team Settings → General).
2. Pick a **project name**, e.g. `acme-toeggelo`. You don't create the project yourself - the first deploy does. Your site will be at `https://<project name>.vercel.app` if that name is still free.

## 3. Your instance repository

1. Create a new **private** repository, e.g. `toeggelo`. (Private matters: GitHub pauses daily jobs in public repositories that see no commits for 60 days.)
2. Add the file `.github/workflows/deploy.yml` with the contents of
   [`instance/deploy.yml`](https://github.com/miltronius/toegg-elo/blob/main/instance/deploy.yml).
3. Settings → Secrets and variables → Actions:

   **Secrets**

   | Name | Value |
   |---|---|
   | `SUPABASE_ACCESS_TOKEN` | the Supabase access token |
   | `SUPABASE_DB_PASSWORD` | the database password |
   | `VERCEL_TOKEN` | the Vercel token |
   | `ADMIN_EMAIL` | the email address you will sign up with - that account becomes the first admin |

   **Variables**

   | Name | Value |
   |---|---|
   | `SUPABASE_PROJECT_REF` | the project ref |
   | `VERCEL_PROJECT` | the project name you picked |
   | `SITE_URL` | `https://<project name>.vercel.app` |
   | `VERCEL_TEAM_ID` | only if the token is scoped to a team |

## 4. First deploy

1. Actions → **Deploy TöggElo** → **Run workflow**. It takes a few minutes.
2. Open your site and **sign up right away with `ADMIN_EMAIL`**. You are the admin;
   everyone else who signs up starts as a viewer until you give them a role
   (Admin → User management).
3. Check the site's address in Vercel (Project → Domains). If it isn't the one in
   `SITE_URL`, correct the variable, and in Supabase set the same address under
   Authentication → URL Configuration (Site URL, and `<address>/**` as a redirect URL).

New accounts are signed in immediately - no confirmation email, since a fresh
Supabase project can't send email to your colleagues yet.

## Optional: email and the magic link

To offer sign-in by email link:

1. Set up custom SMTP in Supabase: Authentication → Emails → SMTP Settings (your
   company's mail server or a provider such as Resend or Postmark).
2. In TöggElo: Admin → Instance settings → Sign in with a magic link → **On**.
3. Optionally, turn "Confirm email" back on (Authentication → Sign In / Providers → Email).

## Your own domain

Add it in Vercel (Project → Domains), then update `SITE_URL` and the Supabase URL
Configuration as in step 4.3.

## Updates

- Every day at 03:23 UTC your repository checks for a new 1.x release and deploys it.
  To update right away: Actions → Deploy TöggElo → Run workflow.
- What changed: click the version number next to the title.
- A **2.0** release won't install by itself. Its release notes say what to do; usually
  it's changing `@v1` to `@v2` in your `deploy.yml`.

## When something goes wrong

- **A deploy failed**: GitHub emails you. The run's log says which step; fix the cause
  (often an expired token) and run the workflow again. Nothing is half-installed - the
  database only changes in complete steps, and the site keeps running the previous version.
- **The site says it can't reach the database**: free Supabase projects pause after a
  week without use. Restore the project in the Supabase dashboard.
- **No admin left**: make sure an account with `ADMIN_EMAIL` exists, then run the
  workflow - it promotes that account whenever the league has no admin.

## Questions, another host, a feature

Open an issue at [github.com/miltronius/toegg-elo/issues](https://github.com/miltronius/toegg-elo/issues).
Only Vercel is supported for the website so far; if you need something else, say so there.
```

- [ ] **Step 2: README**

- Under the intro paragraph, add: `**Run it for your own office:** see [docs/self-hosting.md](docs/self-hosting.md) - three free accounts, updates arrive automatically.`
- Replace the whole "## Elo Calculation" section (the K = 32 / per-opponent text) with:

```markdown
## Elo Calculation

Every player starts each season at **1500**. A recorded match is a series of games, rated on its **margin**: a 2:1 counts like a 1:0, a 3:1 like a 2:0. Each player's expected score is the average of their chances against both opponents, after pulling each rating a quarter of the way towards their partner's (`partner_weight`, set per season). The four rating changes always sum to zero, and winning a series never costs rating. K is set per season (new seasons default to 48).

The full model and the reasoning behind it are in [CLAUDE.md](CLAUDE.md#elo-calculation).
```

- In "Supabase Setup & Deployment", replace step 1 (the SQL-editor instructions) with:

```markdown
1. Create a [Supabase](https://supabase.com) project, link it (step 3) and apply the migrations:

   ```bash
   supabase db push --linked
   ```

   The first migration is a baseline of the whole schema; older, hand-applied
   history is in `supabase/archive/migrations/` for reference only.
```

- In "Deployment", add under Preview/staging and Production: "Apply new migrations first: `supabase db push --linked` (staging freely; prod only with explicit go-ahead)."

- [ ] **Step 3: CLAUDE.md**

Make these edits (keep the file's style: dense paragraphs, bold for traps):

1. **Commands** - add a "### Database (run from repo root)" block:
```bash
supabase db start            # local Postgres on :54422, applies supabase/migrations (Docker)
supabase migration new <name>  # new migration - never hand-name one
supabase migration up --local  # apply pending migrations locally
supabase db push --linked      # apply to the linked project (staging freely, prod with go-ahead)
docker exec -i supabase_db_toegg-elo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/scripts/<x>-checks.sql
```
2. **New section "### Migrations"** (after "Data Flow"):
   - `supabase/migrations/20261003000000_baseline.sql` is prod's schema as of 2026-10-03 (`supabase/scripts/make-baseline.sh` from `supabase db dump`); the 24 hand-applied files before it are in `supabase/archive/migrations/` (history only - the file names cited elsewhere in this document live there now). Staging and prod have the baseline marked applied (`supabase migration repair`), never run.
   - **pg_dump grants are relative to Postgres' defaults, not Supabase's**: restoring a dump on a Supabase project re-grants everything to anon through default privileges. That's why the baseline REVOKEs before its grants - never "simplify" that away.
   - Rules: (1) every migration keeps the **previous release's** frontend and `calculate-elo` working - instances update database → function → frontend and may lag a release; (2) a data fix-up must be harmless on someone else's (empty or different) database; (3) every new table states its grants: `REVOKE ALL ... FROM anon, authenticated`, then the `GRANT`s it needs - new Supabase projects grant nothing on new tables (default since 2026-05-30, all projects from 2026-10-30), ours grant everything; (4) role checks `COALESCE(get_my_role(), '')`, and every SECURITY DEFINER function `REVOKE EXECUTE ... FROM PUBLIC, anon` unless it's meant to be public.
   - `.github/workflows/database.yml` enforces names/order (`frontend/scripts/check-migrations.mjs`), installs from empty, upgrades from the latest release, and runs every `supabase/scripts/*-checks.sql` - **a new checks script is picked up automatically** and must pass on an empty league (bring your own fixtures, e.g. a past season). `function-access-checks.sql` allowlists the SECURITY DEFINER functions anon may execute (`get_my_role`, `get_players`).
   - Local Supabase uses ports 544xx (`supabase/config.toml`), container `supabase_db_toegg-elo`.
3. **New section "### Instances (#56)"** (after "Migrations"): other offices run their own instance on their own GitHub + Supabase + Vercel; the adopter guide is `docs/self-hosting.md`. Their repo holds only `instance/deploy.yml`, which calls `.github/workflows/deploy-instance.yml@v1` daily: `db push` → one-time auth setup (Site URL, "Confirm email" off; tracked by `instance_state.auth_configured_at` so it never overwrites the adopter's later dashboard changes) → `calculate-elo` → `bootstrap_admin(ADMIN_EMAIL)` (every run) → frontend built in CI and published as Vercel prebuilt output (project created via the REST API if missing) → `instance_state.deployed_sha` recorded last. Decisions live in `frontend/scripts/instance-deploy.mjs` (tested). The release workflow force-moves the `vN` tag to each `vN.x.y`; the workflow's `TRACK` constant must be bumped in the PR that releases a new major. `app_settings` (one row, readable by everyone, admins update) holds `magic_link_enabled`; the login screen hides the magic link when it's off; Admin → Instance settings (`InstanceSettingsAdmin`). `instance_state` has no API access. Our own prod/staging don't use the pipeline (Vercel from `main`), which makes them the canary. Secrets are passed one by one in `instance/deploy.yml` because `secrets: inherit` only works within one organization.
4. **Auth & Roles** - replace "**`set_banner_order` has the same flaw, and `apply_inactivity_penalties` has no role check at all; both are still callable by `anon` pending a hotfix.**" with "`set_banner_order` had the same flaw and `apply_inactivity_penalties` no role check at all; the `close_function_access` migration (#56, use its real file name) fixed both (`apply_inactivity_penalties` is now owner/service_role only)." Add after the `calculate-elo` paragraph: "It takes its key from `SUPABASE_SECRET_KEYS` (new projects have no legacy service_role key) and falls back to `SUPABASE_SERVICE_ROLE_KEY` (`keys.ts`), and is deployed with `verify_jwt = false` (`supabase/config.toml`) - its own check is the gate. The frontend's `VITE_SUPABASE_ANON_KEY` may hold a publishable key."
5. **Auth & Roles** - after the `handle_new_user()` sentence: "On an instance without an admin, `handle_new_user` makes the sign-up whose email matches `instance_state.bootstrap_admin_email` (set by `bootstrap_admin`) an admin. `AuthContext.signUp` returns whether the account was signed in right away (instances run without email confirmation)."
6. **Database Schema** - add bullets for `app_settings` and `instance_state` (columns and access as in Task 4).
7. **Data Flow** step 1 - mention `app_settings` is part of `fetchAppData` and falls back to `DEFAULT_APP_SETTINGS` (magic link on) when unreadable.
8. **Tab visibility** - Admin: "(user management + achievement recompute + season options incl. award voting + message banners + instance settings)".
9. **CI** - list `database.yml` and `workflows.yml` (actionlint) next to the existing two.
10. **Releases** - add: "The tag step also force-moves `v<major>` (instances follow it)."

- [ ] **Step 4: Check links and names**

Run: `grep -n "VERCEL_ORG_ID\|VERCEL_PROJECT_ID\|secrets: inherit" docs/self-hosting.md instance/deploy.yml README.md` → nothing except the explanatory comment in `instance/deploy.yml`. Cross-check every secret/variable name in the guide against `deploy-instance.yml`'s `inputs`/`secrets` and `instance/deploy.yml`.

- [ ] **Step 5: Commit**

```bash
git add docs/self-hosting.md README.md CLAUDE.md
git commit -m "ELO-56: Self-hosting guide, migration rules, instance docs"
```

---

### Task 9: Push and run CI

**Files:** none.

- [ ] **Step 1: Full local verification**

```bash
cd frontend && pnpm lint && pnpm test && cd ..
cd supabase/functions/calculate-elo && deno lint && deno check index.ts && deno test -A && cd ../../..
supabase db reset --local
for f in supabase/scripts/*-checks.sql; do docker exec -i supabase_db_toegg-elo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$f" || echo "FAILED: $f"; done
node frontend/scripts/check-migrations.mjs supabase/migrations v1.13.0
```
Expected: everything green, no `FAILED`.

- [ ] **Step 2: Push and open a draft PR** (authorized: push + draft PR, never merge)

```bash
git push -u origin elo-56-portable-instances
gh pr create --draft --base main --title "ELO-56: Portable, self-hosted instances" --body-file <scratch>/pr-body.md
```

PR body: link #56, the spec and the plan; a summary per task; the "Before merge" checklist below verbatim; end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 3: Watch CI**

Run: `gh pr checks --watch`. Expected: Frontend, Deno, Database, Workflows green (changeset-bot comments). Fix failures on the branch; never merge.

---

## Before merge (with the user - not for agents)

1. **End-to-end on a fresh Supabase project.** Staging can't test this: it has legacy keys and old default grants, the two things new projects lack. The free plan allows two active projects (prod + staging), so pause staging or use a paid slot. Create a private test repo with `instance/deploy.yml`, but `uses: miltronius/toegg-elo/.github/workflows/deploy-instance.yml@elo-56-portable-instances` and `with: ref: elo-56-portable-instances`; set the secrets/variables; run it. Check: site loads; sign-up with `ADMIN_EMAIL` → admin; second account → viewer; recording a match works (`calculate-elo` on secret keys); realtime updates; magic link hidden; Admin → Instance settings works. Run again → "already deployed". Push a commit to the branch, run → deploys it. Verify whether `SUPABASE_DB_PASSWORD` is actually needed by `db push` (the CLI may use a temporary login role); drop it from the guide if not.
2. **Staging** (needs the go-ahead the user withheld for now): `supabase migration repair --status applied 20261003000000 --linked`, `supabase db push --linked`, deploy `calculate-elo`, test a Vercel preview.
3. **Prod** (explicit go-ahead): the same three commands against prod, then merge (Vercel deploys the frontend). Magic link stays on (prod has players). Note 2026-10-30: Supabase stops auto-granting new tables on existing projects - the new migrations already grant explicitly.
4. **First release** after the merge creates `v1.14.0` and the `v1` tag; only then can adopters' `@v1` resolve. Then hand the guide to the consultant.
