import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import { bannerDisplayText, storedMessage } from "./bannerText";
import type { Banner } from "./banners";
import type { Season } from "./supabase";

const banner = (o: Partial<Banner> = {}): Banner => ({
  id: "b1",
  message: "Tournament on Friday",
  season_id: null,
  starts_at: null,
  ends_at: null,
  is_active: true,
  audience: "everyone",
  sort_order: 0,
  created_by: null,
  created_at: "2026-08-01T12:00:00Z",
  updated_at: "2026-08-01T12:00:00Z",
  ...o,
});

const SEASONS: Season[] = [
  {
    id: "s2",
    number: 2,
    name: "Summer Slam",
    k_factor: 32,
    partner_weight: 0.333,
    inactivity_penalty_percent: 0,
    started_at: "2026-08-01T00:00:00Z",
    ended_at: null,
    is_active: true,
    created_at: "2026-08-01T00:00:00Z",
  },
];

const CTX = { seasons: SEASONS };

/** Stands in for i18next: echoes the key plus the interpolated values. */
const t = ((key: string, vars?: Record<string, unknown>) =>
  `${key}|${JSON.stringify(vars ?? {})}`) as unknown as TFunction;

describe("bannerDisplayText", () => {
  it("uses the stored message for a hand-written banner", () => {
    expect(bannerDisplayText(banner(), CTX, t)).toBe(
      "Tournament on Friday",
    );
  });

  it("translates a season banner that has no stored message", () => {
    const text = bannerDisplayText(
      banner({ season_id: "s2", message: null }),
      CTX,
      t,
    );
    expect(text).toContain("banner.seasonStarted");
    expect(text).toContain("Summer Slam");
    expect(text).toContain("2");
  });

  it("lets an admin override win over the translation", () => {
    const text = bannerDisplayText(
      banner({ season_id: "s2", message: "Season 2 - fight!" }),
      CTX,
      t,
    );
    expect(text).toBe("Season 2 - fight!");
  });

  it("reverts to the translation when the override is cleared to blank", () => {
    const text = bannerDisplayText(
      banner({ season_id: "s2", message: "  " }),
      CTX,
      t,
    );
    expect(text).toContain("banner.seasonStarted");
  });

  it("returns nothing for a season banner whose season is gone", () => {
    expect(
      bannerDisplayText(
        banner({ season_id: "missing", message: null }),
        CTX,
        t,
      ),
    ).toBe("");
  });

  it("returns nothing rather than 'null' for a message-less normal banner", () => {
    expect(bannerDisplayText(banner({ message: null }), CTX, t)).toBe("");
  });
});

describe("storedMessage", () => {
  const seasonBanner = banner({ season_id: "s2", message: null });
  const generated = bannerDisplayText(seasonBanner, CTX, t);

  it("keeps a season banner translated when the prefilled text is untouched", () => {
    // The form prefills the generated text, so saving without editing must not
    // freeze that language into the row.
    expect(storedMessage(generated, seasonBanner, CTX, t)).toBeNull();
  });

  it("ignores surrounding whitespace when deciding it is unchanged", () => {
    expect(
      storedMessage(`  ${generated}  `, seasonBanner, CTX, t),
    ).toBeNull();
  });

  it("stores genuinely different text as an override", () => {
    expect(storedMessage("My own words", seasonBanner, CTX, t)).toBe(
      "My own words",
    );
  });

  it("reverts to the translation when the field is cleared", () => {
    expect(storedMessage("", seasonBanner, CTX, t)).toBeNull();
    expect(storedMessage("   ", seasonBanner, CTX, t)).toBeNull();
  });

  it("lets an existing override be edited again", () => {
    const overridden = banner({ season_id: "s2", message: "Old words" });
    expect(storedMessage("New words", overridden, CTX, t)).toBe(
      "New words",
    );
  });

  it("drops an override back to the translation by retyping the default", () => {
    const overridden = banner({ season_id: "s2", message: "Old words" });
    expect(storedMessage(generated, overridden, CTX, t)).toBeNull();
  });

  it("stores a normal banner's text verbatim, trimmed", () => {
    expect(storedMessage("  Tournament  ", banner(), CTX, t)).toBe(
      "Tournament",
    );
  });

  it("has no generated default to match against when creating", () => {
    expect(storedMessage("Brand new", null, CTX, t)).toBe("Brand new");
    expect(storedMessage("", null, CTX, t)).toBeNull();
  });
});

describe("Season Awards results banner", () => {
  const S4: Season = { ...SEASONS[0], id: "s4", number: 4, name: "Summer", is_active: false };
  const ctx = {
    seasons: [S4],
    players: [
      { id: "p1", name: "Anna" },
      { id: "p2", name: "Ben" },
      { id: "p3", name: "Carla" },
    ],
    awardResults: [
      { season_id: "s4", award_id: "award_offense" as const, player_id: "p1", votes: 3, is_winner: true },
      { season_id: "s4", award_id: "award_fun" as const, player_id: "p2", votes: 2, is_winner: true },
      { season_id: "s4", award_id: "award_fun" as const, player_id: "p3", votes: 2, is_winner: true },
      { season_id: "s4", award_id: "award_defense" as const, player_id: "p3", votes: 2, is_winner: false },
    ],
  };
  const awardsBanner = banner({ award_season_id: "s4", message: null });

  it("lists the winners, awarded awards only, with the names it is given", () => {
    const text = bannerDisplayText(awardsBanner, ctx, t);
    expect(text).toContain("banner.seasonAwards|");
    expect(text).toContain("⚔️ Anna · 🎉 Ben & Carla");
    expect(text).not.toContain("🛡️");
  });

  it("uses whichever names the viewer gets - anonymous ones for visitors", () => {
    const anon = { ...ctx, players: ctx.players.map((p) => ({ ...p, name: `Anon ${p.id}` })) };
    expect(bannerDisplayText(awardsBanner, anon, t)).toContain("⚔️ Anon p1");
  });

  it("says so when no award reached the minimum", () => {
    const text = bannerDisplayText(awardsBanner, { ...ctx, awardResults: [] }, t);
    expect(text).toContain("banner.seasonAwardsNone");
  });

  it("stays generated when the admin saves it untouched", () => {
    const generated = bannerDisplayText(awardsBanner, ctx, t);
    expect(storedMessage(generated, awardsBanner, ctx, t)).toBeNull();
    expect(storedMessage("Congrats all!", awardsBanner, ctx, t)).toBe("Congrats all!");
  });
});
