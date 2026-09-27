# Link Account to Player (#117) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in `user`/`admin` can claim their player (admins can link, change and unlink), which grants the "That's Me!" achievement, highlights "you" across the UI, and gates the rename controls.

**Architecture:** A new `player_accounts` table (one account ↔ one player) with no write policies; every write goes through SECURITY DEFINER RPCs that also insert/delete the `linked_account` achievement row. `recomputeAllAchievements` derives the same row from `player_accounts`, so an admin recompute keeps it. The frontend reads `is_linked` from `get_players()` and the caller's own link into AuthContext (`myPlayerId`).

**Tech Stack:** Supabase Postgres (plpgsql RPCs, RLS), React 19 + TS, react-i18next, Vitest + RTL, Deno test.

**Spec:** `docs/superpowers/specs/2026-09-24-player-linking-and-season-awards-design.md`, section 1. Issue: miltronius/toegg-elo#117.

## Global Constraints

- Only accounts with role `user` or `admin` can be linked - by self-claim **and** by `admin_link_player` (decided 2026-09-27). Demoting a linked account keeps the link and the achievement.
- One account ↔ one player: `player_id` PK, `user_id` UNIQUE.
- Achievement id `linked_account`, icon 🪪, en "That's Me!" / "Link your account to your player", de "Das bin ich!" / "Verknüpfe dein Konto mit deinem Spieler". `unlocked_at = linked_at`, `meta = null`.
- `linked_account` **counts** toward `achievement_hunter`/`completionist`/`completionist_30` (decided 2026-09-27): it is derived inside `computeAchievementsForPlayer` (new optional `linkedAt` argument) before the meta tally. Every link change triggers a recompute: claim/admin-link → non-destructive `recomputeAllAchievements`; unlink → the admin client deletes that player's three meta rows, then recomputes (so a meta the link had tipped over is revoked, the rest come back with their original dates).
- New achievement ids go into both `frontend/src/lib/achievements.ts` and `supabase/functions/_shared/achievements.ts`, plus `achievementDefs.<id>` in both locale files.
- Server-side rename enforcement is **out of scope** (#118). Also out of scope: RLS still lets any `user` insert `player_achievements` rows directly (pre-existing; a recompute removes a forged `linked_account`).
- TS/TSX strings use `"` quotes. German strings use Swiss spelling (`ss`, no `ß`).
- Commits: no `Co-Authored-By` trailer (user preference).
- Staging (`kitwrozsauxcwcycxibb`) may be migrated and checked freely; **prod needs the user's explicit approval**.

## Review Focus

1. **Anonymous / logged-out caller hits `claim_player`** → refused. `get_my_role()` returns NULL for them, and `NULL NOT IN (...)` is NULL, which an `IF` treats as false. The role checks must `COALESCE`. Pinned by the staging check script (Task 8, check "anon").
2. **The internal link helper called directly by `authenticated`** → permission denied. Supabase's default privileges grant EXECUTE on new `public` functions to `anon`/`authenticated`, so the helper must `REVOKE` explicitly. Pinned in Task 8.
3. **Two concurrent claims of the same player** → one wins, the other gets `player_already_linked` rather than a raw unique-violation message. Task 1 maps `unique_violation` by constraint name. Task 8 checks the mapped message using a pre-existing link (a true race isn't reproducible in one transaction).
4. **Unlink then admin Recompute** → the achievement stays gone; **link then Recompute** → it comes back with the same `unlocked_at`. Pinned by the Deno derivation test (Task 2) plus the staging check (Task 8).
5. **A linked user renames their own player, or another user's claimed one** → allowed / hidden respectively, both names (real and anonymous). Pinned by the `canRenamePlayer` tests (Task 4) and the PlayerDetail gating (Task 5).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260927_player_accounts.sql` (new) | table, RLS, RPCs, `get_players()` with `is_linked` |
| `supabase/scripts/player-accounts-checks.sql` (new) | rolled-back RPC rule checks, re-runnable against staging/prod |
| `frontend/src/lib/achievements.ts`, `supabase/functions/_shared/achievements.ts` | definition, `linkedAccountAchievements`, recompute reads links |
| `supabase/functions/calculate-elo/achievements_test.ts` | Deno derivation test |
| `frontend/src/lib/supabase.ts` | `Player.is_linked`, link RPC wrappers, `getMyPlayerId`, `getAllPlayerAccounts` |
| `frontend/src/lib/playerLinking.ts` (new) + test | `canRenamePlayer`, `canClaimPlayer`, `linkErrorKey` |
| `frontend/src/contexts/AuthContext.tsx` | `myPlayerId`, `refreshMyPlayer`, non-throwing `useMe()` |
| `frontend/src/components/ClaimPlayerDialog.tsx` (new) + test | the confirm dialog |
| `frontend/src/components/PlayerDetail.tsx` | "This is me" button, 🪪 marker, rename gating |
| `frontend/src/components/UserManagement.tsx` | Player column: Link / Change / Unlink |
| `frontend/src/components/Leaderboard.tsx`, `PlayerAutocomplete.tsx`, `App.tsx`, `App.css` | "you" highlight, "My profile" |
| `frontend/src/locales/{en,de}.json` | strings |
| `CLAUDE.md`, `.changeset/*.md` | docs, minor changeset |

---

### Task 1: Migration

**Files:**
- Create: `supabase/migrations/20260927_player_accounts.sql`

**Interfaces:**
- Produces: table `player_accounts(player_id, user_id, linked_at)`. RPCs `claim_player(p_player_id uuid)`, `admin_link_player(p_user_id uuid, p_player_id uuid)`, `unlink_player(p_player_id uuid)`, all `RETURNS void`. Errors are raised as plain messages: `not_allowed`, `account_not_eligible`, `account_already_linked`, `player_already_linked`, `player_not_found`, `not_linked`. `get_players()` gains a trailing `is_linked boolean` column.

- [ ] **Step 1: Write the migration**

```sql
-- Link an account to its player (#117). One account <-> one player. The link
-- lives in its own table rather than on profiles so "is this player claimed"
-- can be exposed (get_players.is_linked) without exposing which account.
-- There are no write policies: every write goes through the RPCs below, which
-- also keep the linked_account achievement in step with the link.

CREATE TABLE player_accounts (
  player_id UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE player_accounts ENABLE ROW LEVEL SECURITY;

-- Own link (AuthContext.myPlayerId) for everyone; every link for admins
-- (User Management). The service role bypasses RLS (calculate-elo recompute).
CREATE POLICY "Read own link, admins read all" ON player_accounts
  FOR SELECT USING (
    user_id = (SELECT auth.uid()) OR get_my_role() = 'admin'
  );

-- Belt and braces: anon/authenticated hold table-level grants on everything in
-- public, and RLS with no write policy already refuses writes - but say it.
REVOKE INSERT, UPDATE, DELETE ON player_accounts FROM anon, authenticated;

-- Shared by claim_player and admin_link_player. Not callable by clients: the
-- callers check *who* may link, this checks *what* may be linked.
CREATE OR REPLACE FUNCTION link_player_account(p_user_id UUID, p_player_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_linked_at TIMESTAMPTZ;
  v_constraint TEXT;
BEGIN
  IF COALESCE((SELECT role FROM profiles WHERE id = p_user_id), '')
       NOT IN ('user', 'admin') THEN
    RAISE EXCEPTION 'account_not_eligible';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM players WHERE id = p_player_id) THEN
    RAISE EXCEPTION 'player_not_found';
  END IF;
  IF EXISTS (SELECT 1 FROM player_accounts WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'account_already_linked';
  END IF;
  IF EXISTS (SELECT 1 FROM player_accounts WHERE player_id = p_player_id) THEN
    RAISE EXCEPTION 'player_already_linked';
  END IF;

  BEGIN
    INSERT INTO player_accounts (player_id, user_id)
    VALUES (p_player_id, p_user_id)
    RETURNING linked_at INTO v_linked_at;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent claim got there between the checks and the insert.
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'player_accounts_pkey' THEN
      RAISE EXCEPTION 'player_already_linked';
    END IF;
    RAISE EXCEPTION 'account_already_linked';
  END;

  -- Same row recomputeAllAchievements derives (unlocked_at = linked_at), so a
  -- later recompute neither duplicates nor moves it.
  INSERT INTO player_achievements (player_id, achievement_id, unlocked_at, meta)
  VALUES (p_player_id, 'linked_account', v_linked_at, NULL)
  ON CONFLICT (player_id, achievement_id)
  DO UPDATE SET unlocked_at = EXCLUDED.unlocked_at, meta = NULL;
END;
$$;

-- Supabase's default privileges grant EXECUTE on new public functions to
-- anon/authenticated; this one must not be reachable from a client.
REVOKE ALL ON FUNCTION link_player_account(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION claim_player(p_player_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- COALESCE: get_my_role() is NULL for a logged-out caller, and NULL NOT IN
  -- (...) is NULL, which IF treats as false - i.e. it would let them through.
  IF COALESCE(get_my_role(), '') NOT IN ('user', 'admin') THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  PERFORM link_player_account(auth.uid(), p_player_id);
END;
$$;

CREATE OR REPLACE FUNCTION admin_link_player(p_user_id UUID, p_player_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(get_my_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  PERFORM link_player_account(p_user_id, p_player_id);
END;
$$;

CREATE OR REPLACE FUNCTION unlink_player(p_player_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(get_my_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  DELETE FROM player_accounts WHERE player_id = p_player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_linked';
  END IF;
  -- The per-match recompute never deletes, so the achievement would otherwise
  -- survive until the next admin recompute.
  DELETE FROM player_achievements
  WHERE player_id = p_player_id AND achievement_id = 'linked_account';
END;
$$;

REVOKE ALL ON FUNCTION claim_player(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION admin_link_player(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION unlink_player(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION claim_player(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_link_player(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION unlink_player(UUID) TO authenticated;

-- get_players() gains is_linked. A function's result columns can't be changed
-- by CREATE OR REPLACE, so drop and recreate (and re-grant).
DROP FUNCTION get_players();
CREATE FUNCTION get_players()
RETURNS TABLE (
  id uuid,
  name text,
  current_elo int,
  matches_played int,
  wins int,
  losses int,
  created_at timestamptz,
  anonymous_name text,
  is_linked boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    CASE WHEN get_my_role() IN ('user', 'admin')
         THEN p.name
         ELSE COALESCE(p.anonymous_name, 'Anonymous') END AS name,
    p.current_elo,
    p.matches_played,
    p.wins,
    p.losses,
    p.created_at,
    CASE WHEN get_my_role() IN ('user', 'admin')
         THEN p.anonymous_name
         ELSE NULL END AS anonymous_name,
    -- Only whether a player is claimed, never by whom.
    EXISTS (SELECT 1 FROM player_accounts pa WHERE pa.player_id = p.id) AS is_linked
  FROM players p
  ORDER BY p.current_elo DESC;
$$;

GRANT EXECUTE ON FUNCTION get_players() TO anon, authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260927_player_accounts.sql
git commit -m "ELO-117: player_accounts table and link RPCs"
```

(Applied and verified on staging in Task 8, once the frontend that reads `is_linked` exists.)

---

### Task 2: `linked_account` achievement + derivation

**Files:**
- Modify: `frontend/src/lib/achievements.ts` (AchievementId union, `ACHIEVEMENT_DEFINITIONS` before `completionist`, new function, `recomputeAllAchievements`)
- Modify: `supabase/functions/_shared/achievements.ts` (identical changes)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/de.json` (`achievementDefs.linked_account`)
- Test: `supabase/functions/calculate-elo/achievements_test.ts`

**Interfaces:**
- Produces (both copies):
  ```ts
  export interface PlayerAccountLink { player_id: string; linked_at: string }
  export function linkedAccountAchievements(
    links: PlayerAccountLink[],
    playerIds: Set<string>,
  ): { player_id: string; achievement_id: AchievementId; unlocked_at: string; meta: null }[]
  ```

- [ ] **Step 1: Write the failing Deno test** (append to `achievements_test.ts`, add `linkedAccountAchievements` to the import)

```ts
Deno.test("linked_account: one row per link, unlocked at linked_at", () => {
  const rows = linkedAccountAchievements(
    [
      { player_id: "p1", linked_at: "2026-09-20T10:00:00+00:00" },
      { player_id: "p2", linked_at: "2026-09-21T08:30:00+00:00" },
    ],
    new Set(["p1", "p2", "p3"]),
  );
  assertEquals(rows, [
    {
      player_id: "p1",
      achievement_id: "linked_account",
      unlocked_at: "2026-09-20T10:00:00.000Z",
      meta: null,
    },
    {
      player_id: "p2",
      achievement_id: "linked_account",
      unlocked_at: "2026-09-21T08:30:00.000Z",
      meta: null,
    },
  ]);
});

Deno.test("linked_account: unlinked players get nothing", () => {
  assertEquals(linkedAccountAchievements([], new Set(["p1"])), []);
});

Deno.test("linked_account: links to players outside the list are skipped", () => {
  // Recompute upserts only for the players it was given; a link to a player
  // it doesn't know about must not produce an orphan row.
  assertEquals(
    linkedAccountAchievements(
      [{ player_id: "gone", linked_at: "2026-09-20T10:00:00Z" }],
      new Set(["p1"]),
    ),
    [],
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `supabase/functions/calculate-elo/`): `deno test -A achievements_test.ts`
Expected: FAIL - `linkedAccountAchievements` is not exported.

- [ ] **Step 3: Implement in `_shared/achievements.ts`**

Add `| "linked_account"` to `AchievementId` just before `| "completionist"`. Add the definition just before the `completionist` entry:

```ts
  {
    id: "linked_account",
    icon: "🪪",
    name: "That's Me!",
    description: "Link your account to your player",
  },
```

Add, directly above the `recomputeAllAchievements` section header:

```ts
// ---------------------------------------------------------------------------
// That's Me! - derived from player_accounts, not from matches
// ---------------------------------------------------------------------------

export interface PlayerAccountLink {
  player_id: string;
  linked_at: string;
}

/**
 * The linked_account rows the link RPCs insert, rebuilt from the links so an
 * admin recompute (which deletes every row first) keeps them. unlocked_at is
 * the link time, matching what claim_player / admin_link_player write, so the
 * per-match upsert (ignoreDuplicates) and the RPC never disagree. Deliberately
 * outside computeAchievementsForPlayer: the meta-achievements count what that
 * returns, and a link is not a play achievement - counting it would leave a
 * stale Completionist behind when an admin unlinks.
 */
export function linkedAccountAchievements(
  links: PlayerAccountLink[],
  playerIds: Set<string>,
): {
  player_id: string;
  achievement_id: AchievementId;
  unlocked_at: string;
  meta: null;
}[] {
  return links
    .filter((l) => playerIds.has(l.player_id))
    .map((l) => ({
      player_id: l.player_id,
      achievement_id: "linked_account",
      unlocked_at: new Date(l.linked_at).toISOString(),
      meta: null,
    }));
}
```

In `recomputeAllAchievements`, after the `for (const player of players)` loop and before `if (rows.length === 0) return;`:

```ts
  // Links are the one input that isn't match data. Throw rather than skip on a
  // failed read: the admin recompute has already deleted every row, so a
  // silent skip would revoke everyone's That's Me!.
  const { data: links, error: linksError } = await supabase
    .from("player_accounts")
    .select("player_id, linked_at");
  if (linksError) throw linksError;
  rows.push(
    ...linkedAccountAchievements(
      (links ?? []) as PlayerAccountLink[],
      new Set(players.map((p) => p.id)),
    ),
  );
```

- [ ] **Step 4: Mirror into `frontend/src/lib/achievements.ts`** - the identical union member, definition, section, function and recompute block. Then `diff frontend/src/lib/achievements.ts supabase/functions/_shared/achievements.ts` must show only the pre-existing header/type differences.

- [ ] **Step 5: Locale strings** - in `achievementDefs`, after `pair_goals_1000`:
  - en: `"linked_account": { "name": "That's Me!", "description": "Link your account to your player" },`
  - de: `"linked_account": { "name": "Das bin ich!", "description": "Verknüpfe dein Konto mit deinem Spieler" },`

- [ ] **Step 6: Run tests**

Run: `deno lint && deno test -A` (in `supabase/functions/calculate-elo/`), `deno check index.ts`, and `pnpm test` (in `frontend/`).
Expected: all PASS. If a frontend test pins the number of `ACHIEVEMENT_DEFINITIONS` or the locale key set, update it. Such a test is guarding exactly this change.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions frontend/src/lib/achievements.ts frontend/src/locales
git commit -m "ELO-117: That's Me! achievement derived from player_accounts"
```

---

### Task 3: Data layer + AuthContext

**Files:**
- Modify: `frontend/src/lib/supabase.ts`
- Modify: `frontend/src/contexts/AuthContext.tsx`
- Modify: every test fixture that builds a `Player` (grep `anonymous_name: null` under `frontend/src`) - add `is_linked: false`

**Interfaces:**
- Produces (`supabase.ts`):
  ```ts
  Player.is_linked: boolean
  export type PlayerAccount = { player_id: string; user_id: string; linked_at: string };
  export async function getMyPlayerId(userId: string): Promise<string | null>
  export async function getAllPlayerAccounts(): Promise<PlayerAccount[]>
  export async function claimPlayer(playerId: string): Promise<void>
  export async function adminLinkPlayer(userId: string, playerId: string): Promise<void>
  export async function unlinkPlayer(playerId: string): Promise<void>
  ```
- Produces (`AuthContext.tsx`): `useAuth()` gains `myPlayerId: string | null` and `refreshMyPlayer: () => Promise<void>`. New `useMe(): { role: Role | null; myPlayerId: string | null; refreshMyPlayer: () => Promise<void> }`, which returns nulls and a no-op outside a provider.

- [ ] **Step 1: `supabase.ts`** - add to `Player` after `anonymous_name`:

```ts
  /** Whether an account has claimed this player. Never says which account. */
  is_linked: boolean;
```

Add after `updateUserRole`:

```ts
export type PlayerAccount = {
  player_id: string;
  user_id: string;
  linked_at: string;
};

/** The caller's own linked player, or null. RLS only returns your own row. */
export async function getMyPlayerId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("player_accounts")
    .select("player_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.player_id ?? null;
}

/** Admin-only (RLS): every link, for User Management. */
export async function getAllPlayerAccounts(): Promise<PlayerAccount[]> {
  const { data, error } = await supabase.from("player_accounts").select("*");
  if (error) throw error;
  return data ?? [];
}

// The link RPCs raise plain codes (player_already_linked, ...) as the error
// message; playerLinking.ts turns them into translated text.
export async function claimPlayer(playerId: string) {
  markLocalMutation();
  const { error } = await supabase.rpc("claim_player", {
    p_player_id: playerId,
  });
  if (error) throw error;
}

export async function adminLinkPlayer(userId: string, playerId: string) {
  markLocalMutation();
  const { error } = await supabase.rpc("admin_link_player", {
    p_user_id: userId,
    p_player_id: playerId,
  });
  if (error) throw error;
}

export async function unlinkPlayer(playerId: string) {
  markLocalMutation();
  const { error } = await supabase.rpc("unlink_player", {
    p_player_id: playerId,
  });
  if (error) throw error;
}
```

- [ ] **Step 2: `AuthContext.tsx`** - add `myPlayerId` state, loaded wherever the role is. Replace the two `getMyRole().then(setRole)...` sites with a `loadIdentity(user.id)` helper, and clear both on sign-out:

```tsx
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);

  const loadIdentity = (userId: string) => {
    getMyRole().then(setRole).catch(() => setRole(null));
    getMyPlayerId(userId).then(setMyPlayerId).catch(() => setMyPlayerId(null));
  };

  const refreshMyPlayer = async () => {
    if (!user) return;
    setMyPlayerId(await getMyPlayerId(user.id));
  };
```

In the `getSession` callback use `if (session?.user) loadIdentity(session.user.id);`. In `onAuthStateChange` use `loadIdentity(session.user.id)`, and in the `else` branch add `setMyPlayerId(null);` next to `setRole(null)`. Add `myPlayerId` and `refreshMyPlayer` to the context type and value. Then append:

```tsx
const NO_ME = {
  role: null,
  myPlayerId: null,
  refreshMyPlayer: async () => {},
} as const;

/**
 * The signed-in account's role and linked player, for components that only
 * *mark* things ("you", rename rights). Unlike useAuth it doesn't throw
 * outside a provider, so those components keep rendering in isolation (tests).
 */
export function useMe(): {
  role: Role | null;
  myPlayerId: string | null;
  refreshMyPlayer: () => Promise<void>;
} {
  const ctx = useContext(AuthContext);
  return ctx
    ? { role: ctx.role, myPlayerId: ctx.myPlayerId, refreshMyPlayer: ctx.refreshMyPlayer }
    : NO_ME;
}
```

- [ ] **Step 3: Fixtures** - add `is_linked: false,` after every `anonymous_name: null,` in `frontend/src/**/*.test.ts(x)`.

- [ ] **Step 4: Verify**

Run (in `frontend/`): `pnpm lint && pnpm test`. Then `pnpm exec tsc --noEmit`, which should show no new errors beyond the known `Leaderboard.tsx` ones.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "ELO-117: link RPC wrappers and myPlayerId in AuthContext"
```

---

### Task 4: `playerLinking.ts` helpers

**Files:**
- Create: `frontend/src/lib/playerLinking.ts`
- Test: `frontend/src/lib/playerLinking.test.ts`

**Interfaces:**
- Consumes: `Player` (`is_linked`), `Role`.
- Produces:
  ```ts
  export type Me = { role: Role | null; myPlayerId: string | null };
  export function canRenamePlayer(player: Pick<Player, "id" | "is_linked">, me: Me): boolean
  export function canClaimPlayer(player: Pick<Player, "is_linked">, me: Me): boolean
  export const LINK_ERROR_CODES: readonly string[]
  export function linkErrorKey(error: unknown): string | null  // "linking.errors.<code>" or null
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { canClaimPlayer, canRenamePlayer, linkErrorKey } from "./playerLinking";

const unclaimed = { id: "p1", is_linked: false };
const claimed = { id: "p1", is_linked: true };

describe("canRenamePlayer", () => {
  it("lets an admin rename anyone, claimed or not", () => {
    expect(canRenamePlayer(claimed, { role: "admin", myPlayerId: null })).toBe(true);
    expect(canRenamePlayer(unclaimed, { role: "admin", myPlayerId: "p9" })).toBe(true);
  });
  it("lets any user rename an unclaimed player", () => {
    expect(canRenamePlayer(unclaimed, { role: "user", myPlayerId: null })).toBe(true);
    expect(canRenamePlayer(unclaimed, { role: "user", myPlayerId: "p9" })).toBe(true);
  });
  it("lets the linked owner rename their own player", () => {
    expect(canRenamePlayer(claimed, { role: "user", myPlayerId: "p1" })).toBe(true);
  });
  it("stops a user renaming someone else's claimed player", () => {
    expect(canRenamePlayer(claimed, { role: "user", myPlayerId: "p9" })).toBe(false);
    expect(canRenamePlayer(claimed, { role: "user", myPlayerId: null })).toBe(false);
  });
  it("never lets a viewer or a logged-out visitor rename", () => {
    expect(canRenamePlayer(unclaimed, { role: "viewer", myPlayerId: null })).toBe(false);
    expect(canRenamePlayer(claimed, { role: "viewer", myPlayerId: "p1" })).toBe(false);
    expect(canRenamePlayer(unclaimed, { role: null, myPlayerId: null })).toBe(false);
  });
});

describe("canClaimPlayer", () => {
  it("offers an unclaimed player to an unlinked user or admin", () => {
    expect(canClaimPlayer(unclaimed, { role: "user", myPlayerId: null })).toBe(true);
    expect(canClaimPlayer(unclaimed, { role: "admin", myPlayerId: null })).toBe(true);
  });
  it("hides it once either side is linked", () => {
    expect(canClaimPlayer(claimed, { role: "user", myPlayerId: null })).toBe(false);
    expect(canClaimPlayer(unclaimed, { role: "user", myPlayerId: "p9" })).toBe(false);
  });
  it("never offers it to a viewer", () => {
    expect(canClaimPlayer(unclaimed, { role: "viewer", myPlayerId: null })).toBe(false);
    expect(canClaimPlayer(unclaimed, { role: null, myPlayerId: null })).toBe(false);
  });
});

describe("linkErrorKey", () => {
  it("maps an RPC error code to its translation key", () => {
    expect(linkErrorKey({ message: "player_already_linked" })).toBe(
      "linking.errors.player_already_linked",
    );
    expect(linkErrorKey(new Error("not_allowed"))).toBe("linking.errors.not_allowed");
  });
  it("returns null for anything else", () => {
    expect(linkErrorKey(new Error("Failed to fetch"))).toBeNull();
    expect(linkErrorKey("player_already_linked")).toBeNull();
    expect(linkErrorKey(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test playerLinking`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import type { Player, Role } from "./supabase";

/** Who is looking: the signed-in role and their linked player, if any. */
export type Me = { role: Role | null; myPlayerId: string | null };

/**
 * Name protection, UI side (the server doesn't enforce it until #118): admins
 * rename anyone, the linked owner renames their own player, and any user may
 * still rename a player nobody has claimed. Covers the real and anonymous name
 * alike - both are "who this is". Viewers never rename, even a linked one who
 * was demoted: RLS would refuse their write anyway.
 */
export function canRenamePlayer(
  player: Pick<Player, "id" | "is_linked">,
  me: Me,
): boolean {
  if (me.role === "admin") return true;
  if (me.role !== "user") return false;
  return !player.is_linked || player.id === me.myPlayerId;
}

/** Mirrors claim_player: a user/admin with no player, on an unclaimed one. */
export function canClaimPlayer(
  player: Pick<Player, "is_linked">,
  me: Me,
): boolean {
  return (
    (me.role === "user" || me.role === "admin") &&
    me.myPlayerId === null &&
    !player.is_linked
  );
}

/** The codes the link RPCs raise (see 20260927_player_accounts.sql). */
export const LINK_ERROR_CODES = [
  "not_allowed",
  "account_not_eligible",
  "account_already_linked",
  "player_already_linked",
  "player_not_found",
  "not_linked",
] as const;

/** Translation key for a link RPC error, or null for anything unexpected. */
export function linkErrorKey(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return null;
  }
  const message = (error as { message: unknown }).message;
  return (LINK_ERROR_CODES as readonly unknown[]).includes(message)
    ? `linking.errors.${message}`
    : null;
}
```

- [ ] **Step 4: Run tests.** `pnpm test playerLinking` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/playerLinking.ts frontend/src/lib/playerLinking.test.ts
git commit -m "ELO-117: canRenamePlayer / canClaimPlayer helpers"
```

---

### Task 5: Claim dialog + PlayerDetail

**Files:**
- Create: `frontend/src/components/ClaimPlayerDialog.tsx`
- Test: `frontend/src/components/ClaimPlayerDialog.test.tsx`
- Modify: `frontend/src/components/PlayerDetail.tsx`
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/de.json` (new top-level `linking` block)

**Interfaces:**
- Consumes: `claimPlayer`, `useMe`, `canClaimPlayer`, `canRenamePlayer`, `linkErrorKey`.
- Produces: `ClaimPlayerDialog({ playerName, onConfirm, onClose }: { playerName: string; onConfirm: () => Promise<void>; onClose: () => void })`. A rejected `onConfirm` keeps the dialog open and shows the error; success is the parent's to handle (it closes the dialog).

- [ ] **Step 1: Locale strings.** Add a top-level `linking` block to both files. en:

```json
  "linking": {
    "claim": "🪪 This is me",
    "claimTitle": "Claim player",
    "claimBody": "You're claiming <b>{{name}}</b>. Only an admin can undo this.",
    "claimConfirm": "Claim",
    "claiming": "Claiming...",
    "cancel": "Cancel",
    "claimed": "Claimed by an account",
    "you": "(you)",
    "myProfile": "🪪 My profile",
    "unknownError": "Something went wrong. Please try again.",
    "errors": {
      "not_allowed": "You're not allowed to do that.",
      "account_not_eligible": "Only user and admin accounts can be linked.",
      "account_already_linked": "This account is already linked to a player.",
      "player_already_linked": "Someone has already claimed this player.",
      "player_not_found": "That player no longer exists.",
      "not_linked": "That player isn't linked to an account."
    }
  },
```

de:

```json
  "linking": {
    "claim": "🪪 Das bin ich",
    "claimTitle": "Spieler beanspruchen",
    "claimBody": "Du beanspruchst <b>{{name}}</b>. Nur ein Admin kann das rückgängig machen.",
    "claimConfirm": "Beanspruchen",
    "claiming": "Wird beansprucht...",
    "cancel": "Abbrechen",
    "claimed": "Mit einem Konto verknüpft",
    "you": "(du)",
    "myProfile": "🪪 Mein Profil",
    "unknownError": "Etwas ist schiefgelaufen. Bitte versuche es nochmals.",
    "errors": {
      "not_allowed": "Das darfst du nicht.",
      "account_not_eligible": "Nur Konten mit der Rolle User oder Admin können verknüpft werden.",
      "account_already_linked": "Dieses Konto ist bereits mit einem Spieler verknüpft.",
      "player_already_linked": "Dieser Spieler wurde bereits beansprucht.",
      "player_not_found": "Diesen Spieler gibt es nicht mehr.",
      "not_linked": "Dieser Spieler ist mit keinem Konto verknüpft."
    }
  },
```

- [ ] **Step 2: Write the failing dialog test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClaimPlayerDialog } from "./ClaimPlayerDialog";

describe("ClaimPlayerDialog", () => {
  it("names the player and warns that only an admin can undo it", () => {
    render(
      <ClaimPlayerDialog playerName="Anna" onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText("Anna").tagName).toBe("B");
    expect(screen.getByText(/Only an admin can undo this/)).toBeInTheDocument();
  });

  it("claims on confirm", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ClaimPlayerDialog playerName="Anna" onConfirm={onConfirm} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Claim" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("stays open and explains a refusal from the server", async () => {
    const onConfirm = vi.fn().mockRejectedValue({ message: "player_already_linked" });
    const onClose = vi.fn();
    render(<ClaimPlayerDialog playerName="Anna" onConfirm={onConfirm} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Claim" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Someone has already claimed this player.",
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("falls back to a generic message for an unexpected error", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    render(<ClaimPlayerDialog playerName="Anna" onConfirm={onConfirm} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Claim" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong"),
    );
  });

  it("cancels without claiming", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ClaimPlayerDialog playerName="Anna" onConfirm={onConfirm} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
```

(If `@testing-library/user-event` isn't a dependency, check how `BannerAdmin.test.tsx` clicks and use `fireEvent.click` the same way.)

- [ ] **Step 3: Run to verify it fails.** `pnpm test ClaimPlayerDialog` → FAIL, module not found.

- [ ] **Step 4: Implement `ClaimPlayerDialog.tsx`**

```tsx
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { linkErrorKey } from "../lib/playerLinking";

interface ClaimPlayerDialogProps {
  playerName: string;
  /** Performs the claim. A rejection keeps the dialog open with the reason. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

/**
 * Confirms a self-claim. Deliberately a second step: a claim can't be undone
 * by the claimer, so a misclick on "This is me" must not be enough. Carries
 * `modal-panel`, so the Win95 theme styles it with no markup of its own.
 */
export function ClaimPlayerDialog({
  playerName,
  onConfirm,
  onClose,
}: ClaimPlayerDialogProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(t(linkErrorKey(e) ?? "linking.unknownError"));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
      onClick={onClose}
    >
      <div
        className="modal-panel bg-white rounded-xl shadow-2xl w-full max-w-md p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="claim-player-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="claim-player-title" className="text-xl font-bold mb-3">
          {t("linking.claimTitle")}
        </h2>
        <p className="mb-4">
          <Trans
            i18nKey="linking.claimBody"
            values={{ name: playerName }}
            components={{ b: <b /> }}
          />
        </p>
        {error && (
          <div
            role="alert"
            className="bg-error-light text-error px-4 py-3 rounded-md text-sm border-l-4 border-error mb-4"
          >
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            {t("linking.cancel")}
          </button>
          <button className="btn-primary" onClick={confirm} disabled={busy}>
            {busy ? t("linking.claiming") : t("linking.claimConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

(`z-[60]` sits above PlayerDetail's `z-50` backdrop, since the dialog opens from inside it.)

- [ ] **Step 5: Run the dialog tests.** `pnpm test ClaimPlayerDialog` → PASS.

- [ ] **Step 6: Wire into `PlayerDetail.tsx`.**
  - Imports: `claimPlayer` from `../lib/supabase`, `useMe` from `../contexts/AuthContext`, `canClaimPlayer, canRenamePlayer` from `../lib/playerLinking`, `ClaimPlayerDialog` from `./ClaimPlayerDialog`.
  - After `const { t } = useTranslation();`:
    ```tsx
    const me = useMe();
    const canRename = canRenamePlayer(player, me);
    const canClaim = canClaimPlayer(player, me);
    const [claimOpen, setClaimOpen] = useState(false);
    ```
  - Close the dialog when navigating: add `setClaimOpen(false);` to the "Reset inline editors" effect.
  - Real name: the `<h2>` gets `onClick={canRename ? () => setIsEditingName(true) : undefined}`, and its `className` keeps `cursor-pointer hover:text-primary transition-colors` only when `canRename`. Guard the editor too: `{isEditingName && canRename ? (...editor...) : (...)}`.
  - After the `<h2>`, before the streak badges:
    ```tsx
    {player.is_linked && (
      <span title={t("linking.claimed")} aria-label={t("linking.claimed")}>
        🪪
      </span>
    )}
    ```
  - Anonymous name: the `isEditingAnon ?` branch becomes `isEditingAnon && canRename ?`. In the display `<span>`, set `onClick` only when `canRename`, and keep the `cursor-pointer hover:text-primary` classes and the edit-hint `title` only when `canRename`. When not renamable, show `🎭 {anonName}`, or nothing at all when `anonName` is empty (no "Set anonymous name" prompt the viewer can't act on).
  - The claim button goes at the end of the anonymous-name row (`ml-auto` so it sits right):
    ```tsx
    {canClaim && (
      <button className="btn-small ml-auto" onClick={() => setClaimOpen(true)}>
        {t("linking.claim")}
      </button>
    )}
    ```
  - Before the final closing `</div>` of the backdrop:
    ```tsx
    {claimOpen && (
      <ClaimPlayerDialog
        playerName={player.name}
        onClose={() => setClaimOpen(false)}
        onConfirm={async () => {
          await claimPlayer(player.id);
          await me.refreshMyPlayer();
          setClaimOpen(false);
          onPlayerRefresh?.();
        }}
      />
    )}
    ```
    Clicks inside the dialog must not reach PlayerDetail's backdrop `onClose`. The dialog's own backdrop `onClick={onClose}` does bubble to the PlayerDetail panel, but that panel already `stopPropagation`s, so it only closes the dialog. Verify this manually in Task 8.

- [ ] **Step 7: Verify.** `pnpm lint && pnpm test` → PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src
git commit -m "ELO-117: claim dialog, claimed marker and rename gating in PlayerDetail"
```

---

### Task 6: User Management Player column

**Files:**
- Modify: `frontend/src/components/UserManagement.tsx`
- Modify: `frontend/src/App.tsx` (pass `players`, refresh callback)
- Modify: `frontend/src/locales/en.json`, `de.json` (`userManagement` keys)

**Interfaces:**
- Consumes: `getAllPlayerAccounts`, `adminLinkPlayer`, `unlinkPlayer`, `linkErrorKey`, `PlayerAutocomplete`, `useAuth().refreshMyPlayer`.
- Produces: `UserManagement({ players, onRecomputed, onLinksChanged }: { players: Player[]; onRecomputed?: () => void; onLinksChanged?: () => void })`.

- [ ] **Step 1: Strings** (`userManagement` block).
  - en: `"player": "Player"`, `"link": "Link"`, `"change": "Change"`, `"unlink": "Unlink"`, `"pickPlayer": "Pick a player..."`, `"linkViewerHint": "Make them a user first"`, `"confirmUnlink": "Unlink {{player}} from {{email}}? This also removes their That's Me! achievement."`, `"linkError": "Failed to update the link"`.
  - de: `"player": "Spieler"`, `"link": "Verknüpfen"`, `"change": "Ändern"`, `"unlink": "Trennen"`, `"pickPlayer": "Spieler wählen..."`, `"linkViewerHint": "Zuerst zum User machen"`, `"confirmUnlink": "{{player}} von {{email}} trennen? Damit verschwindet auch der Erfolg «Das bin ich!»."`, `"linkError": "Verknüpfung konnte nicht geändert werden"`.

- [ ] **Step 2: Implement.** In `UserManagement`:
  - Load the links alongside the profiles:
    ```tsx
    const { user, refreshMyPlayer } = useAuth();
    const [links, setLinks] = useState<PlayerAccount[]>([]);
    // profile id currently choosing a player (Link or Change), or null
    const [picking, setPicking] = useState<string | null>(null);

    useEffect(() => {
      Promise.all([getAllProfiles(), getAllPlayerAccounts()])
        .then(([p, l]) => {
          setProfiles(p);
          setLinks(l);
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }, []);

    const playerById = new Map(players.map((p) => [p.id, p]));
    const linkedPlayerIds = links.map((l) => l.player_id);

    const afterLinkChange = async (profileId: string) => {
      setLinks(await getAllPlayerAccounts());
      if (profileId === user?.id) await refreshMyPlayer();
      onLinksChanged?.();
    };

    const reportLinkError = (e: unknown) =>
      setLinkError(t(linkErrorKey(e) ?? "userManagement.linkError"));

    const handleLink = async (profile: Profile, playerId: string) => {
      if (!playerId) return;
      setSaving(profile.id);
      setLinkError(null);
      const current = links.find((l) => l.user_id === profile.id);
      try {
        // Change = unlink + link, as the spec defines a reassign. If the link
        // half fails the account is left unlinked, and the error says why.
        if (current) await unlinkPlayer(current.player_id);
        await adminLinkPlayer(profile.id, playerId);
      } catch (e) {
        reportLinkError(e);
      } finally {
        setPicking(null);
        setSaving(null);
        await afterLinkChange(profile.id);
      }
    };

    const handleUnlink = async (profile: Profile, link: PlayerAccount) => {
      const name = playerById.get(link.player_id)?.name ?? "?";
      if (!confirm(t("userManagement.confirmUnlink", { player: name, email: profile.email }))) return;
      setSaving(profile.id);
      setLinkError(null);
      try {
        await unlinkPlayer(link.player_id);
      } catch (e) {
        reportLinkError(e);
      } finally {
        setSaving(null);
        await afterLinkChange(profile.id);
      }
    };
    ```
    Add `const [linkError, setLinkError] = useState<string | null>(null);` and render it above the table in the same error style as `error`, but non-fatal (the table stays).
  - Add a `<th>{t("userManagement.player")}</th>` between Role and Joined, with the same classes as the other headers.
  - Cell, same `td` classes:
    ```tsx
    <td className="px-3 py-2.5 border-b border-border-light">
      {(() => {
        const link = links.find((l) => l.user_id === profile.id);
        if (picking === profile.id) {
          return (
            <div className="flex items-center gap-2">
              <PlayerAutocomplete
                compact
                players={players}
                value=""
                excludeIds={linkedPlayerIds}
                placeholder={t("userManagement.pickPlayer")}
                onChange={(id) => handleLink(profile, id)}
                disabled={saving === profile.id}
              />
              <button className="btn-small btn-cancel" onClick={() => setPicking(null)}>✕</button>
            </div>
          );
        }
        if (link) {
          return (
            <div className="flex items-center gap-2">
              <span>🪪 {playerById.get(link.player_id)?.name ?? "?"}</span>
              <button className="btn-small" onClick={() => setPicking(profile.id)} disabled={saving === profile.id}>
                {t("userManagement.change")}
              </button>
              <button className="btn-small btn-cancel" onClick={() => handleUnlink(profile, link)} disabled={saving === profile.id}>
                {t("userManagement.unlink")}
              </button>
            </div>
          );
        }
        if (profile.role === "viewer") {
          return <span className="text-text-light text-[0.8rem]">{t("userManagement.linkViewerHint")}</span>;
        }
        return (
          <button className="btn-small" onClick={() => setPicking(profile.id)}>
            {t("userManagement.link")}
          </button>
        );
      })()}
    </td>
    ```
  - `App.tsx`: `<UserManagement players={players} onRecomputed={refresh} onLinksChanged={refresh} />`.

- [ ] **Step 3: Verify.** `pnpm lint && pnpm test` → PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "ELO-117: link, change and unlink players in User Management"
```

---

### Task 7: "You" highlight + My profile

**Files:**
- Modify: `frontend/src/components/Leaderboard.tsx` (~line 785 row)
- Modify: `frontend/src/components/PlayerAutocomplete.tsx` (~line 231 option)
- Modify: `frontend/src/App.tsx` (header)
- Modify: `frontend/src/App.css`
- Test: `frontend/src/components/Leaderboard.test.tsx`, `frontend/src/components/PlayerAutocomplete.test.tsx`

**Interfaces:**
- Consumes: `useMe().myPlayerId`, `useAuth().myPlayerId`.

- [ ] **Step 1: Failing tests.** Both components call `useMe()`, so a test sets "me" by wrapping in the real `AuthContext` provider value. Export the context for tests from `AuthContext.tsx` (`export const AuthContextForTests = AuthContext;`), or add a tiny `MeProvider`-free helper: in each test, `vi.mock("../contexts/AuthContext", () => ({ useMe: () => ({ role: "user", myPlayerId: "p1", refreshMyPlayer: async () => {} }) }))`. Use the `vi.mock` form, which needs no production-code export. Add:
  - `PlayerAutocomplete.test.tsx`: with `myPlayerId: "p1"`, opening the list shows `(you)` next to p1's name and nowhere else.
  - `Leaderboard.test.tsx`: p1's row has class `row-me`, the others don't.

  (Put the `vi.mock` at file top. If the existing tests in those files need "no me", create a mutable `let me = {...}` the mock reads, and reset it in `beforeEach`.)

- [ ] **Step 2: Run to verify failure.** `pnpm test Leaderboard PlayerAutocomplete` → the new assertions FAIL.

- [ ] **Step 3: Implement.**
  - Leaderboard: `const { myPlayerId } = useMe();`. The row's `className` becomes `` `clickable-row${rowClass ? ` ${rowClass}` : ""}${player.id === myPlayerId ? " row-me" : ""}` ``.
  - PlayerAutocomplete: `const { myPlayerId } = useMe();`, and after the name span: `{player.id === myPlayerId && <span className="player-ac-you">{t("linking.you")}</span>}`.
  - App.css, next to the `row-top`/`row-bottom` rules:
    ```css
    /* Your own row. An inset bar rather than a background, so it stacks with
       the top/bottom band tints instead of replacing them. */
    .leaderboard-table tbody tr.row-me td:first-child {
      box-shadow: inset 4px 0 0 var(--primary);
    }
    .leaderboard-table tbody tr.row-me td.name {
      font-weight: 700;
    }
    .player-ac-you {
      margin-left: 0.35em;
      color: var(--text-light);
      font-size: 0.85em;
    }
    ```
    Check that `--primary` and `--text-light` are the actual var names in App.css, and adjust if they differ.
  - App header: `const { user, role, myPlayerId, loading: authLoading, signOut } = useAuth();`. Inside the `user ?` fragment, before the role chip:
    ```tsx
    {myPlayerId && canEdit && (
      <button
        className="btn-secondary"
        onClick={() => {
          setPlayerDetailInitialTab("stats");
          setSelectedPlayerId(myPlayerId);
        }}
      >
        {t("linking.myProfile")}
      </button>
    )}
    ```

- [ ] **Step 4: Verify.** `pnpm lint && pnpm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "ELO-117: highlight your own player and add My profile"
```

---

### Task 8: Staging, docs, changeset

**Files:**
- Create: `supabase/scripts/player-accounts-checks.sql`
- Modify: `CLAUDE.md`
- Create: `.changeset/<name>.md`

- [ ] **Step 1: Check what staging actually runs.** Link staging into a scratch workdir (see memory "Supabase environments"), then run `SELECT pg_get_functiondef('get_players()'::regprocedure);`. It must match `20260530_anonymous_names.sql`, since the migration recreates it from that body. If staging differs, stop and reconcile before applying.

- [ ] **Step 2: Apply** `20260927_player_accounts.sql` to staging with `supabase db query --linked --workdir <scratch>/staging -f <abs path>`.

- [ ] **Step 3: Write `player-accounts-checks.sql`.** Everything runs inside `BEGIN ... ROLLBACK`, so it leaves nothing behind and is safe to re-run against prod after approval. Each check raises `FAIL: ...` on a wrong outcome.

```sql
-- Rule checks for the player link RPCs (#117). Runs inside a transaction that
-- is always rolled back: fixtures, links and achievement rows all disappear.
-- Usage: supabase db query --linked -f <abs path to this file>
BEGIN;

-- Fixtures. auth.users inserts fire handle_new_user, which makes viewer profiles.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-00000000a001', 'link-user@test.invalid'),
  ('00000000-0000-4000-8000-00000000a002', 'link-admin@test.invalid'),
  ('00000000-0000-4000-8000-00000000a003', 'link-viewer@test.invalid'),
  ('00000000-0000-4000-8000-00000000a004', 'link-user2@test.invalid');
UPDATE profiles SET role = 'user'  WHERE id IN ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000a004');
UPDATE profiles SET role = 'admin' WHERE id = '00000000-0000-4000-8000-00000000a002';
INSERT INTO players (id, name) VALUES
  ('00000000-0000-4000-8000-00000000b001', 'Link Check 1'),
  ('00000000-0000-4000-8000-00000000b002', 'Link Check 2');

-- act as: pass a user id, or NULL for a logged-out (anon) caller
CREATE FUNCTION pg_temp.act_as(uid UUID) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    CASE WHEN uid IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', uid, 'role', 'authenticated')::text END,
    true);
$$;

-- expect(sql, code): run sql, require it to fail with exactly `code`
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

SET LOCAL ROLE anon;
SELECT pg_temp.act_as(NULL);
SELECT pg_temp.expect('anon cannot claim', $$SELECT claim_player('00000000-0000-4000-8000-00000000b001')$$, 'permission denied for function claim_player');

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('00000000-0000-4000-8000-00000000a003');
SELECT pg_temp.expect('viewer cannot claim', $$SELECT claim_player('00000000-0000-4000-8000-00000000b001')$$, 'not_allowed');
SELECT pg_temp.expect('helper not callable', $$SELECT link_player_account('00000000-0000-4000-8000-00000000a003', '00000000-0000-4000-8000-00000000b001')$$, 'permission denied for function link_player_account');

SELECT pg_temp.act_as('00000000-0000-4000-8000-00000000a001');
SELECT pg_temp.expect('user claims', $$SELECT claim_player('00000000-0000-4000-8000-00000000b001')$$, NULL);
SELECT pg_temp.expect('claim twice', $$SELECT claim_player('00000000-0000-4000-8000-00000000b002')$$, 'account_already_linked');
SELECT pg_temp.expect('user cannot unlink', $$SELECT unlink_player('00000000-0000-4000-8000-00000000b001')$$, 'not_allowed');
SELECT pg_temp.expect('user cannot admin-link', $$SELECT admin_link_player('00000000-0000-4000-8000-00000000a004', '00000000-0000-4000-8000-00000000b002')$$, 'not_allowed');
SELECT pg_temp.expect('user sees own link', $$DO $d$ BEGIN IF (SELECT count(*) FROM player_accounts) <> 1 THEN RAISE EXCEPTION 'saw %', (SELECT count(*) FROM player_accounts); END IF; END $d$$$, NULL);
SELECT pg_temp.expect('no direct insert', $$INSERT INTO player_accounts (player_id, user_id) VALUES ('00000000-0000-4000-8000-00000000b002', '00000000-0000-4000-8000-00000000a004')$$, 'permission denied for table player_accounts');

SELECT pg_temp.act_as('00000000-0000-4000-8000-00000000a004');
SELECT pg_temp.expect('claim a claimed player', $$SELECT claim_player('00000000-0000-4000-8000-00000000b001')$$, 'player_already_linked');
SELECT pg_temp.expect('other user sees no links', $$DO $d$ BEGIN IF (SELECT count(*) FROM player_accounts) <> 0 THEN RAISE EXCEPTION 'leak'; END IF; END $d$$$, NULL);
SELECT pg_temp.expect('get_players exposes is_linked', $$DO $d$ BEGIN IF NOT (SELECT is_linked FROM get_players() WHERE id = '00000000-0000-4000-8000-00000000b001') THEN RAISE EXCEPTION 'not linked'; END IF; END $d$$$, NULL);

SELECT pg_temp.act_as('00000000-0000-4000-8000-00000000a002');
SELECT pg_temp.expect('admin cannot link a viewer', $$SELECT admin_link_player('00000000-0000-4000-8000-00000000a003', '00000000-0000-4000-8000-00000000b002')$$, 'account_not_eligible');
SELECT pg_temp.expect('achievement granted with linked_at', $$DO $d$ BEGIN IF NOT EXISTS (SELECT 1 FROM player_achievements pa JOIN player_accounts l USING (player_id) WHERE pa.player_id = '00000000-0000-4000-8000-00000000b001' AND pa.achievement_id = 'linked_account' AND pa.unlocked_at = l.linked_at) THEN RAISE EXCEPTION 'missing'; END IF; END $d$$$, NULL);
SELECT pg_temp.expect('admin unlinks', $$SELECT unlink_player('00000000-0000-4000-8000-00000000b001')$$, NULL);
SELECT pg_temp.expect('unlink revokes achievement', $$DO $d$ BEGIN IF EXISTS (SELECT 1 FROM player_achievements WHERE player_id = '00000000-0000-4000-8000-00000000b001' AND achievement_id = 'linked_account') THEN RAISE EXCEPTION 'still there'; END IF; END $d$$$, NULL);
SELECT pg_temp.expect('unlink twice', $$SELECT unlink_player('00000000-0000-4000-8000-00000000b001')$$, 'not_linked');
SELECT pg_temp.expect('admin links a user', $$SELECT admin_link_player('00000000-0000-4000-8000-00000000a004', '00000000-0000-4000-8000-00000000b001')$$, NULL);

RESET ROLE;
ROLLBACK;
```

If `supabase db query` rejects the explicit transaction or `SET LOCAL ROLE`, fall back to running the same statements through `psql` against the staging pooler URL. Don't weaken the checks.

- [ ] **Step 4: Run it on staging.** Expected: an `ok` notice for every check and no `FAIL`. Afterwards confirm nothing persisted: `SELECT count(*) FROM player_accounts;` still returns the pre-run count, and no `%@test.invalid` users exist. Then check `pg_policies` for `player_accounts` shows exactly the one SELECT policy.

- [ ] **Step 5: Manual smoke on staging** (`pnpm dev`, `.env.local` points at staging): as a `user`, claim a player → dialog → 🪪 on the player, "My profile" appears, your leaderboard row is marked, "(du)/(you)" appears in Record Match, and That's Me! is in Achievements. Another user sees the 🪪 and no rename on that player. As admin: Change and Unlink in User Management, and the achievement disappears. Run Admin → Recompute: the linked players keep That's Me!, the unlinked one doesn't get it back. Check all three themes, including Win95 for the dialog title bar. **Do not** touch prod; report what is ready for it instead.

- [ ] **Step 6: CLAUDE.md.**
  - Frontend Structure: a `lib/playerLinking.ts` entry (name protection is UI-only until #118; `linkErrorKey` maps the RPC codes). A `ClaimPlayerDialog.tsx` entry.
  - AuthContext: mention `myPlayerId`, `refreshMyPlayer`, `useMe`.
  - Database Schema: a `player_accounts` entry (no write policies; RPCs; the achievement is inserted/deleted by them and derived by the recompute; `linked_account` is not counted by meta-achievements; only `user`/`admin` accounts can be linked; `get_my_role()` is NULL for anon, so role checks `COALESCE`; the helper is REVOKEd because of Supabase's default EXECUTE grants).
  - Mention that `get_players()` returns `is_linked`.
  - Tab visibility: "My profile" appears for linked `user`/`admin`.

- [ ] **Step 7: Changeset** `.changeset/link-account-to-player.md`:

```md
---
"toegg-elo-frontend": minor
---

Claim your player: open your player and press "This is me" to link your account - you get the That's Me! 🪪 achievement, your row is highlighted, and only you (or an admin) can rename your player.
Adds `player_accounts` with the `claim_player` / `admin_link_player` / `unlink_player` RPCs (migration `20260927_player_accounts.sql`) and a Player column in Admin → User Management. Name protection is UI-only until #118.
```

- [ ] **Step 8: Full verification.** `pnpm lint && pnpm test` (frontend), then `deno lint && deno test -A && deno check index.ts` (calculate-elo). Everything must be green.

- [ ] **Step 9: Commit**

```bash
git add supabase/scripts/player-accounts-checks.sql CLAUDE.md .changeset
git commit -m "ELO-117: staging checks, docs and changeset"
```

Then hand over. PR creation and the prod migration (plus deploying `calculate-elo`, since the shared achievements changed) wait for the user.
