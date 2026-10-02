import type { TFunction } from "i18next";
import type { Player, Season } from "./supabase";
import { isGeneratedBanner, type Banner } from "./banners";
import { AWARD_MIN_VOTES, awardStandings, type AwardResult } from "./seasonAwards";

/**
 * What a generated banner's text is built from. A season banner needs only
 * the seasons; a Season Awards results banner also needs the results and the
 * player list - the one from get_players(), which already carries anonymous
 * names for viewers and logged-out visitors, so real names never reach them.
 */
export type BannerContext = {
  seasons: Season[];
  awardResults?: AwardResult[];
  players?: Pick<Player, "id" | "name">[];
};

/**
 * The text a banner actually shows.
 *
 * Its own module rather than part of `banners.ts` because it is the one place
 * banner data meets translation, and `banners.ts` is deliberately free of any
 * dependency beyond plain data.
 *
 * A season banner and a results banner start with no stored message so each
 * viewer gets the announcement in their own language (and, for results, with
 * the names they're allowed to see); once an admin writes one, that text wins
 * for everybody. Clearing the field reverts to the generated text.
 *
 * Returns "" when a generated banner outlives the season it points at
 * (deleting a season cascades the row away, so this is a belt-and-braces
 * case) - callers drop empty strings rather than render a blank slot.
 */
export function bannerDisplayText(banner: Banner, ctx: BannerContext, t: TFunction): string {
  if (!isGeneratedBanner(banner)) return banner.message ?? "";

  if (banner.award_season_id) {
    const season = ctx.seasons.find((s) => s.id === banner.award_season_id);
    return season ? awardsBannerText(season, ctx, t) : "";
  }

  const season = ctx.seasons.find((s) => s.id === banner.season_id);
  if (!season) return "";

  return t("banner.seasonStarted", {
    number: season.number,
    name: season.name,
  });
}

/** "🏆 S4 · Summer Awards: ⚔️ Anna · 🎉 Ben & Carla" - the awarded ones only. */
function awardsBannerText(season: Season, ctx: BannerContext, t: TFunction): string {
  const nameOf = (id: string) => ctx.players?.find((p) => p.id === id)?.name ?? "?";
  const winners = awardStandings(ctx.awardResults ?? [], season.id)
    .filter((s) => s.awarded)
    .map(
      (s) =>
        `${s.award.icon} ${s.nominees
          .filter((n) => n.isWinner)
          .map((n) => nameOf(n.playerId))
          .join(" & ")}`,
    );
  const vars = { number: season.number, name: season.name };
  return winners.length > 0
    ? t("banner.seasonAwards", { ...vars, winners: winners.join(" · ") })
    : t("banner.seasonAwardsNone", { ...vars, min: AWARD_MIN_VOTES });
}

/**
 * What to store for the text an admin typed into the edit form.
 *
 * The form pre-fills a generated banner's field with its generated text so it
 * can be edited in place rather than guessed at from a placeholder. That makes
 * "saved without touching it" indistinguishable from "deliberately typed the
 * same words" at the DB level - and storing them would silently freeze the
 * announcement into whichever language (and names) the admin happened to be
 * viewing. So an unchanged (or cleared) generated message stores NULL, i.e.
 * stays generated; only genuinely different text becomes an override.
 *
 * `banner` is null when creating, where there is no generated default to match.
 */
export function storedMessage(
  typed: string,
  banner: Banner | null,
  ctx: BannerContext,
  t: TFunction,
): string | null {
  const text = typed.trim();
  if (!banner?.season_id && !banner?.award_season_id) return text || null;

  const generated = bannerDisplayText({ ...banner, message: null }, ctx, t).trim();
  return !text || text === generated ? null : text;
}
