/**
 * Finding a player by typing their name.
 *
 * Ordering is alphabetical rather than by Elo: the picker is for *finding
 * someone you already have in mind*, and a list that reshuffles as ratings
 * change has no stable place to look. The leaderboard is where rank belongs.
 *
 * Pure helpers only - no DB calls, no React.
 */

import { DATE_LOCALE } from "./i18n";

/** Anything with a display name and an id - `Player` satisfies it. */
export interface NamedPlayer {
  id: string;
  name: string;
}

/**
 * Locale-aware so the German umlauts and accents in this league's names sort
 * where a reader expects (ä with a, not after z), matching the Swiss locale the
 * rest of the app formats with.
 */
export function comparePlayerNames(a: NamedPlayer, b: NamedPlayer): number {
  return a.name.localeCompare(b.name, DATE_LOCALE, { sensitivity: "base" });
}

export function sortPlayersByName<T extends NamedPlayer>(players: T[]): T[] {
  return [...players].sort(comparePlayerNames);
}

/**
 * Lowercased and stripped of diacritics, so typing "muller" finds "Müller" -
 * nobody reaches for the umlaut key mid-search.
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Players matching `query`, alphabetical within two tiers: names that *start*
 * with the query first, then names that merely contain it. Typing "an" should
 * offer Anna before Susanne, while still not hiding Susanne.
 *
 * An empty query lists everyone, so opening the picker shows the full roster.
 */
export function filterPlayers<T extends NamedPlayer>(
  players: T[],
  query: string,
): T[] {
  const q = normalizeForSearch(query);
  if (!q) return sortPlayersByName(players);

  const prefix: T[] = [];
  const contains: T[] = [];
  for (const player of players) {
    const name = normalizeForSearch(player.name);
    if (name.startsWith(q)) prefix.push(player);
    else if (name.includes(q)) contains.push(player);
  }

  return [...sortPlayersByName(prefix), ...sortPlayersByName(contains)];
}

/**
 * Where the highlight lands after a key press, wrapping at both ends so the
 * list is reachable in either direction without a long hold.
 */
export function nextHighlight(
  current: number,
  delta: number,
  length: number,
): number {
  if (length === 0) return -1;
  // A fresh list has no highlight (-1); the first Down should land on 0 and the
  // first Up on the last entry.
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return (current + delta + length) % length;
}
