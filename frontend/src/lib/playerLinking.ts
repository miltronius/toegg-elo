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
