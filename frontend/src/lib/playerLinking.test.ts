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
