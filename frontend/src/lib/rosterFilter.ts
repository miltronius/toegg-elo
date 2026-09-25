/**
 * Who counts as "part of the season".
 *
 * A player only becomes *ranked* once they have played `RANKED_MIN_GAMES` games
 * in the season in scope - a single lucky (or unlucky) guest appearance
 * shouldn't top or tail the board. Everyone below that still exists and still
 * has an ELO; they're just filtered out of the ranked view.
 *
 * The two narrowing views earn their place by how much they'd actually show:
 * offered at `FILTER_MIN_ENTRIES` players, auto-selected at
 * `AUTO_SELECT_MIN_ENTRIES`. So a board is never empty because of a filter, and
 * never *defaults* to a view too thin to read.
 *
 * Pure helpers only - no DB calls, no React.
 */

/** Games needed in the season in scope before a player is ranked. */
export const RANKED_MIN_GAMES = 3;

/** A narrowing view is only offered once it would show this many players. */
export const FILTER_MIN_ENTRIES = 1;

/**
 * A narrowing view is only auto-selected once it would show this many.
 *
 * 4 because a 2v2 match *is* 4 players: one recorded game fills the played
 * view, so it takes over immediately rather than after some arbitrary warm-up,
 * and 4 ranked players is likewise the fewest that could field a match among
 * themselves.
 */
export const AUTO_SELECT_MIN_ENTRIES = 4;

/**
 * `all` - the whole roster, including players who never played this season.
 * `played` - at least one game.
 * `ranked` - at least `RANKED_MIN_GAMES` games.
 */
export type RosterFilter = "all" | "played" | "ranked";

/** Widest → narrowest; also the render order of the toggle. */
export const ROSTER_FILTERS: readonly RosterFilter[] = [
  "all",
  "played",
  "ranked",
];

/**
 * The views on offer for a scope. Ranking is a per-season idea - "3 games" means
 * 3 games in *this* season - and all-time the only players without a game are
 * ones added and never used, so all-time has nothing worth narrowing: it is
 * fixed to `all`. Callers still render the toggle (locked) so the header doesn't
 * reshuffle when switching between a season and all-time.
 */
export function rosterFiltersFor(
  isSeasonView: boolean,
): readonly RosterFilter[] {
  return isSeasonView ? ROSTER_FILTERS : ALL_TIME_FILTERS;
}

const ALL_TIME_FILTERS: readonly RosterFilter[] = ["all"];

/** How many players each view would show. */
export type RosterCounts = Record<RosterFilter, number>;

/** Anything carrying a games-played count for the scope being filtered. */
interface RosterEntry {
  matches_played: number;
}

/** Games a player needs to survive `filter`. */
export function minGamesFor(filter: RosterFilter): number {
  if (filter === "ranked") return RANKED_MIN_GAMES;
  return filter === "played" ? 1 : 0;
}

/**
 * Callers pass season-scoped players (Leaderboard overrides `matches_played`
 * with the season's wins+losses), so the same helper covers season and
 * all-time views.
 */
export function filterRoster<T extends RosterEntry>(
  players: T[],
  filter: RosterFilter,
): T[] {
  const min = minGamesFor(filter);
  return min === 0 ? players : players.filter((p) => p.matches_played >= min);
}

export function isRanked(player: RosterEntry): boolean {
  return player.matches_played >= RANKED_MIN_GAMES;
}

/** One pass for all three views - both gating rules read from this. */
export function rosterCounts(players: RosterEntry[]): RosterCounts {
  let played = 0;
  let ranked = 0;
  for (const p of players) {
    if (p.matches_played > 0) played++;
    if (isRanked(p)) ranked++;
  }
  return { all: players.length, played, ranked };
}

/**
 * `all` is always offered: it's the widest view, so nothing is hidden behind a
 * disabled button. The narrowing views are offered only when they'd show
 * someone - a button that leads to a blank table is worse than no button.
 */
export function isFilterAvailable(
  filter: RosterFilter,
  counts: RosterCounts,
): boolean {
  return filter === "all" || counts[filter] >= FILTER_MIN_ENTRIES;
}

/**
 * Narrowest view with a full match's worth of players, else the whole roster.
 * Early in a season hardly anyone has three games, so defaulting to ranked
 * would show a board of one or two - `AUTO_SELECT_MIN_ENTRIES` stops that,
 * while still letting the played view take over from the very first match.
 */
export function defaultRosterFilter(
  counts: RosterCounts,
  offered: readonly RosterFilter[] = ROSTER_FILTERS,
): RosterFilter {
  const readable = (f: RosterFilter) =>
    offered.includes(f) && counts[f] >= AUTO_SELECT_MIN_ENTRIES;
  if (readable("ranked")) return "ranked";
  if (readable("played")) return "played";
  return "all";
}

/**
 * A pinned choice only holds while it has data - switching to a season where
 * nobody qualifies drops back to the default instead of stranding the user on
 * an empty board whose own button is disabled. Likewise a choice the scope
 * doesn't offer at all (ranked, carried over into all-time).
 */
export function resolveRosterFilter(
  choice: RosterFilter | null,
  counts: RosterCounts,
  offered: readonly RosterFilter[] = ROSTER_FILTERS,
): RosterFilter {
  return choice && offered.includes(choice) && isFilterAvailable(choice, counts)
    ? choice
    : defaultRosterFilter(counts, offered);
}
