import { assertEquals, assertRejects } from "@std/assert";
import { type AuthLookups, authorizeRecorder } from "./auth.ts";

const USER_TOKEN = "user-session-jwt";
const ANON_KEY = "anon-key-jwt";

/** Tokens → users → roles, standing in for Auth and the profiles table. */
function lookups(
  roles: Record<string, string | null>,
  users: Record<string, string> = {},
): AuthLookups & { roleLookups: string[] } {
  const roleLookups: string[] = [];
  return {
    roleLookups,
    userIdForToken: (token) => Promise.resolve(users[token] ?? null),
    roleForUser: (userId) => {
      roleLookups.push(userId);
      return Promise.resolve(userId in roles ? roles[userId] : null);
    },
  };
}

Deno.test("auth: no Authorization header is refused as signed out", async () => {
  const result = await authorizeRecorder(null, lookups({}));
  assertEquals(result, {
    ok: false,
    status: 401,
    error: "Sign in to record a match",
  });
});

Deno.test("auth: a header that is not a bearer token is refused", async () => {
  for (const header of ["", "Bearer", "Bearer ", `Basic ${USER_TOKEN}`]) {
    const result = await authorizeRecorder(
      header,
      lookups({}, { [USER_TOKEN]: "u1" }),
    );
    assertEquals(result.ok, false, header);
    if (!result.ok) assertEquals(result.status, 401, header);
  }
});

Deno.test("auth: the anon key passes verify_jwt but is no user, so it is refused", async () => {
  const deps = lookups({ u1: "admin" }, { [USER_TOKEN]: "u1" });
  const result = await authorizeRecorder(`Bearer ${ANON_KEY}`, deps);
  assertEquals(result, {
    ok: false,
    status: 401,
    error: "Sign in to record a match",
  });
  assertEquals(deps.roleLookups, [], "no profile lookup without a user");
});

Deno.test("auth: a viewer is signed in but may not record", async () => {
  const result = await authorizeRecorder(
    `Bearer ${USER_TOKEN}`,
    lookups({ u1: "viewer" }, { [USER_TOKEN]: "u1" }),
  );
  assertEquals(result, {
    ok: false,
    status: 403,
    error: "Your role cannot record matches",
  });
});

Deno.test("auth: a user without a profile is refused, not given a default role", async () => {
  const result = await authorizeRecorder(
    `Bearer ${USER_TOKEN}`,
    lookups({}, { [USER_TOKEN]: "u1" }),
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 403);
});

Deno.test("auth: user and admin may record, matching the insert RLS policy", async () => {
  for (const role of ["user", "admin"]) {
    const result = await authorizeRecorder(
      `Bearer ${USER_TOKEN}`,
      lookups({ u1: role }, { [USER_TOKEN]: "u1" }),
    );
    assertEquals(result, { ok: true, userId: "u1" }, role);
  }
});

Deno.test("auth: the bearer scheme is case-insensitive", async () => {
  const result = await authorizeRecorder(
    `bearer ${USER_TOKEN}`,
    lookups({ u1: "user" }, { [USER_TOKEN]: "u1" }),
  );
  assertEquals(result.ok, true);
});

Deno.test("auth: a failing role lookup propagates instead of reading as 'no role'", async () => {
  await assertRejects(
    () =>
      authorizeRecorder(`Bearer ${USER_TOKEN}`, {
        userIdForToken: () => Promise.resolve("u1"),
        roleForUser: () => Promise.reject(new Error("db down")),
      }),
    Error,
    "db down",
  );
});
