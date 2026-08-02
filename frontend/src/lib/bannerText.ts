import type { TFunction } from "i18next";
import type { Season } from "./supabase";
import { isGeneratedSeasonBanner, type Banner } from "./banners";

/**
 * The text a banner actually shows.
 *
 * Its own module rather than part of `banners.ts` because it is the one place
 * banner data meets translation, and `banners.ts` is deliberately free of any
 * dependency beyond plain data.
 *
 * A season banner starts with no stored message so each viewer gets the
 * announcement in their own language; once an admin writes one, that text wins
 * for everybody. Clearing the field reverts to the translation.
 *
 * Returns "" when a season banner outlives the season it points at (deleting a
 * season cascades the row away, so this is a belt-and-braces case) - callers
 * drop empty strings rather than render a blank slot.
 */
export function bannerDisplayText(
  banner: Banner,
  seasons: Season[],
  t: TFunction,
): string {
  if (!isGeneratedSeasonBanner(banner)) return banner.message ?? "";

  const season = seasons.find((s) => s.id === banner.season_id);
  if (!season) return "";

  return t("banner.seasonStarted", {
    number: season.number,
    name: season.name,
  });
}

/**
 * What to store for the text an admin typed into the edit form.
 *
 * The form pre-fills a season banner's field with the generated announcement so
 * it can be edited in place rather than guessed at from a placeholder. That
 * makes "saved without touching it" indistinguishable from "deliberately typed
 * the same words" at the DB level - and storing them would silently freeze the
 * announcement into whichever language the admin happened to be viewing. So an
 * unchanged (or cleared) season message stores NULL, i.e. stays translated;
 * only genuinely different text becomes an override.
 *
 * `banner` is null when creating, where there is no generated default to match.
 */
export function storedMessage(
  typed: string,
  banner: Banner | null,
  seasons: Season[],
  t: TFunction,
): string | null {
  const text = typed.trim();
  if (!banner?.season_id) return text || null;

  const generated = bannerDisplayText(
    { ...banner, message: null },
    seasons,
    t,
  ).trim();
  return !text || text === generated ? null : text;
}
