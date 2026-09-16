/**
 * Who may record a match through this function.
 *
 * The function writes with the service role, so the RLS policies on `matches`,
 * `elo_history` and `players` never see the caller - this check is the only
 * thing standing in for "Users and admins can insert matches". The platform's
 * `verify_jwt` gate is no substitute: it accepts the anon key (a valid JWT with
 * no user behind it) and the new publishable keys, both of which ship in the
 * frontend bundle.
 *
 * Kept free of Supabase imports so the decision can be tested without a
 * network; index.ts supplies the two lookups.
 */

/** Mirrors the "Users and admins can insert matches" RLS policy. */
export const RECORDING_ROLES: readonly string[] = ["user", "admin"];

export type Authorization =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; error: string };

export interface AuthLookups {
  /** The user a bearer token belongs to, or null if it is not a live user session. */
  userIdForToken(token: string): Promise<string | null>;
  /** The user's profile role, or null if they have no profile. Throws on lookup failure. */
  roleForUser(userId: string): Promise<string | null>;
}

const SIGN_IN = "Sign in to record a match";

export async function authorizeRecorder(
  authorization: string | null,
  lookups: AuthLookups,
): Promise<Authorization> {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return { ok: false, status: 401, error: SIGN_IN };

  const userId = await lookups.userIdForToken(token);
  if (!userId) return { ok: false, status: 401, error: SIGN_IN };

  // A missing profile is refused rather than treated as a default role: the
  // handle_new_user trigger creates one on signup, so its absence is an anomaly.
  const role = await lookups.roleForUser(userId);
  if (role === null || !RECORDING_ROLES.includes(role)) {
    return { ok: false, status: 403, error: "Your role cannot record matches" };
  }

  return { ok: true, userId };
}
