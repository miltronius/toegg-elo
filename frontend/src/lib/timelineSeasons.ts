/**
 * How the Timeline splits into seasons: which season a day belongs to, where
 * each season's band goes among the day sections, and how many days have to
 * be rendered before a season's band exists (the Timeline renders older days
 * lazily, so its list of contents must be able to ask for them).
 *
 * Days are "YYYY-MM-DD" keys, the UTC slice the Timeline groups by. Pure - no
 * DB calls, no React.
 */
import type { Season } from "./supabase";

type SeasonLike = Pick<Season, "id" | "number" | "started_at">;

/**
 * The season running on `day`: the newest one that had started by then. A day
 * before every season (matches recorded before seasons existed) belongs to
 * the oldest. The day a season starts belongs to it, even though the previous
 * one ended that same day - that day's boundary event says both.
 */
export function seasonForDay<S extends SeasonLike>(day: string, seasons: S[]): S | null {
  let running: S | null = null;
  let oldest: S | null = null;
  for (const s of seasons) {
    if (!oldest || s.number < oldest.number) oldest = s;
    if (s.started_at.slice(0, 10) <= day && (!running || s.number > running.number)) running = s;
  }
  return running ?? oldest;
}

export type TimelineItem<D, S> = { kind: "season"; season: S } | { kind: "day"; day: D };

/**
 * Interleaves a band per season with the day sections, both newest first:
 * each season's band, then its days. A season with no days still gets its
 * band, in its place in time (a just-started season, a season nobody played).
 */
export function withSeasonBands<D extends { date: string }, S extends SeasonLike>(
  days: D[],
  seasons: S[],
): TimelineItem<D, S>[] {
  if (seasons.length === 0) return days.map((day) => ({ kind: "day", day }));
  const daysBySeason = new Map<string, D[]>();
  for (const day of days) {
    const season = seasonForDay(day.date, seasons)!;
    const list = daysBySeason.get(season.id) ?? [];
    list.push(day);
    daysBySeason.set(season.id, list);
  }
  const items: TimelineItem<D, S>[] = [];
  for (const season of [...seasons].sort((a, b) => b.number - a.number)) {
    items.push({ kind: "season", season });
    for (const day of daysBySeason.get(season.id) ?? []) items.push({ kind: "day", day });
  }
  return items;
}

/**
 * The items to render when only the newest `visibleDays` days are shown. A
 * band shows once the day above it is shown - or right away at the very top -
 * so the list never ends on a band that has none of its days under it, unless
 * that season has no days at all.
 */
export function visibleItems<D, S>(
  items: TimelineItem<D, S>[],
  visibleDays: number,
): TimelineItem<D, S>[] {
  const out: TimelineItem<D, S>[] = [];
  let daysShown = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "day") {
      if (daysShown >= visibleDays) break;
      daysShown++;
      out.push(item);
    } else {
      const next = items[i + 1];
      const hasOwnDays = next?.kind === "day";
      if (hasOwnDays && daysShown >= visibleDays) break;
      out.push(item);
    }
  }
  return out;
}

/** How many days must be shown for `seasonId`'s band and its first day to render. */
export function daysToReveal<D, S extends { id: string }>(
  items: TimelineItem<D, S>[],
  seasonId: string,
): number {
  let days = 0;
  for (const item of items) {
    if (item.kind === "season" && item.season.id === seasonId) return days + 1;
    if (item.kind === "day") days++;
  }
  return days;
}
