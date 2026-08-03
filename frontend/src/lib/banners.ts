/**
 * What the message banner shows, and when.
 *
 * Every banner is a row in the `banners` table, including the new-season
 * announcement: a DB trigger inserts one whenever a season starts, so an admin
 * can edit, reschedule, retarget or delete it like any other.
 *
 * A row holds one language, which is why a season banner's `message` starts
 * NULL, meaning "render the built-in translated announcement". The moment an
 * admin types a message the stored text wins, and clearing it reverts to the
 * translation. `isGeneratedSeasonBanner` is that distinction.
 *
 * Visibility is a window (`starts_at`/`ends_at`, either bound optional) gated by
 * `is_active`. Keeping the switch separate from the window is what lets an
 * admin park a scheduled message without losing its dates.
 *
 * Every decision is a pure function of `(data, now)` so the UI can re-evaluate
 * on a timer: a window opening or closing changes nothing in the database, so
 * no realtime event ever announces it.
 *
 * Pure helpers only - no DB calls, no React.
 */

/**
 * How long a new season stays announced. Descriptive only - the real window is
 * on the row, written by the `create_season_banner` trigger, so an admin can
 * change it per season. Kept in sync with that trigger's INTERVAL.
 */
export const SEASON_BANNER_DAYS = 14;

/**
 * Who an announcement is addressed to. `members` covers every signed-in role,
 * viewer included - the split is logged-in vs the public landing view, not a
 * permission tier. RLS already withholds `members` rows from anonymous callers;
 * `forAudience` re-checks so an admin previews what each side actually sees.
 */
export type BannerAudience = "everyone" | "members";

export const BANNER_AUDIENCES: readonly BannerAudience[] = [
  "everyone",
  "members",
];

export type Banner = {
  id: string;
  /** NULL on a season banner means "render the translated default". */
  message: string | null;
  /** Set only on the banner a season start created. */
  season_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  audience: BannerAudience;
  /** Hand-set running order, lowest first; `created_at` breaks ties. */
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * A season banner whose text an admin hasn't overridden, so the viewer should
 * see the translated announcement rather than anything stored. Blank-but-set
 * counts as not overridden, which is what makes clearing the field in the admin
 * form a revert rather than an empty banner.
 */
export function isGeneratedSeasonBanner(banner: Banner): boolean {
  return banner.season_id !== null && !banner.message?.trim();
}

/**
 * `live` - on screen right now.
 * `scheduled` - active, but its window hasn't opened yet.
 * `expired` - active, but its window has closed.
 * `hidden` - switched off, whatever the window says.
 */
export type BannerStatus = "live" | "scheduled" | "expired" | "hidden";

/** Unparseable or absent timestamps count as "no bound" rather than throwing. */
function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function bannerStatus(banner: Banner, now: number): BannerStatus {
  if (!banner.is_active) return "hidden";

  const ends = parseTime(banner.ends_at);
  if (ends !== null && now >= ends) return "expired";

  const starts = parseTime(banner.starts_at);
  if (starts !== null && now < starts) return "scheduled";

  return "live";
}

/** A `members` banner reaches signed-in viewers only; `everyone` reaches all. */
export function forAudience(banner: Banner, signedIn: boolean): boolean {
  return banner.audience === "everyone" || signedIn;
}

/**
 * The admin's hand-set order first, newest-first within a tie.
 *
 * Everything starts at `sort_order` 0, so until someone drags a row this is
 * purely newest-first - and a banner created after a reorder also lands at 0,
 * keeping "the latest announcement leads" for anything not hand-placed.
 */
export function orderBanners(banners: Banner[]): Banner[] {
  return [...banners].sort(
    (a, b) =>
      a.sort_order - b.sort_order ||
      (parseTime(b.created_at) ?? 0) - (parseTime(a.created_at) ?? 0),
  );
}

/** Those on screen right now for this viewer, in running order. */
export function visibleBanners(
  banners: Banner[],
  now: number,
  signedIn: boolean,
): Banner[] {
  return orderBanners(
    banners.filter(
      (b) => bannerStatus(b, now) === "live" && forAudience(b, signedIn),
    ),
  );
}

/**
 * `list` with the item at `from` moved to `to`. Returns the original array
 * untouched when the move is a no-op or either index is out of range, so a
 * drag that ends where it started causes no re-render and no write.
 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length)
    return list;

  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// ── Swiss wall-clock text <-> ISO ────────────────────────────────────────────
//
// The window fields are plain text in `dd.mm.yyyy hh:mm`, not
// `<input type="datetime-local">`: a native picker renders in the *browser's*
// locale, which no attribute can override, so a de-CH user on an en-US browser
// would get mm/dd/yyyy here while every other date in the app (DATE_LOCALE) is
// Swiss. Parsing it ourselves is the only way to keep one format everywhere.
//
// Both directions are wall-clock local time: an admin scheduling "18:00" means
// 18:00 where they are.

/** The format these fields read and write, shown to the admin as a hint. */
export const SWISS_DATETIME_FORMAT = "dd.mm.yyyy hh:mm";

// Time is optional (midnight if omitted); separators are lenient about spaces
// and a comma, since "2.8.2026, 18:00" is what a copy-paste from the app's own
// date formatting looks like.
const SWISS_DATETIME_RE =
  /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[\s,]+(\d{1,2}):(\d{2}))?$/;

/** ISO instant → `dd.mm.yyyy hh:mm` in local time. Empty for no bound. */
export function toSwissDateTime(iso: string | null): string {
  const ms = parseTime(iso);
  if (ms === null) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Format keystrokes into `dd.mm.yyyy hh:mm` as the admin types.
 *
 * Works off the digits alone and re-inserts every separator, so the punctuation
 * can never end up doubled or in the wrong place however the field is edited -
 * pasting `03082026 1800`, typing the dots by hand, and backspacing all land on
 * the same result. Trailing separators are only added once a digit follows, so
 * deleting backwards doesn't fight the mask by re-adding the character just
 * removed.
 */
export function maskSwissDateTime(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 12);
  if (!digits) return "";

  const parts = [
    digits.slice(0, 2),
    digits.slice(2, 4),
    digits.slice(4, 8),
    digits.slice(8, 10),
    digits.slice(10, 12),
  ].filter(Boolean);

  let out = parts[0];
  if (parts[1]) out += `.${parts[1]}`;
  if (parts[2]) out += `.${parts[2]}`;
  if (parts[3]) out += ` ${parts[3]}`;
  if (parts[4]) out += `:${parts[4]}`;
  return out;
}

/**
 * Three outcomes, not two: a blank field means "no bound", but a typo has to be
 * reported rather than silently dropped - quietly treating `31.02.2026` as "no
 * end date" would publish a banner that never stops.
 */
export type ParsedMoment =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "ok"; iso: string };

export function parseSwissDateTime(value: string): ParsedMoment {
  const text = value.trim();
  if (!text) return { kind: "empty" };

  const m = SWISS_DATETIME_RE.exec(text);
  if (!m) return { kind: "invalid" };

  const [, dd, mm, yyyy, hh = "0", min = "0"] = m;
  const day = Number(dd);
  const month = Number(mm);
  const hours = Number(hh);
  const minutes = Number(min);
  if (month < 1 || month > 12 || day < 1 || hours > 23 || minutes > 59) {
    return { kind: "invalid" };
  }

  const d = new Date(Number(yyyy), month - 1, day, hours, minutes);
  // Rejects real-looking but non-existent dates: JS rolls 31.02 over into March,
  // so a field that survives the round-trip is the date the admin actually typed.
  if (d.getMonth() !== month - 1 || d.getDate() !== day) {
    return { kind: "invalid" };
  }

  return { kind: "ok", iso: d.toISOString() };
}

// ── Run-length presets ──────────────────────────────────────────────────────

/** One-click run lengths offered next to the window fields. */
export const BANNER_DURATIONS = ["1w", "2w", "1m"] as const;

export type BannerDuration = (typeof BANNER_DURATIONS)[number];

/**
 * When a banner starting at `startMs` should stop, if it runs for `duration`.
 *
 * Calendar arithmetic, not fixed multiples of 24h: "a month" means the same day
 * next month, which is what an admin picking it means. JS overflow applies at
 * the edges (31 Jan + 1 month lands in early March), which is the conventional
 * behaviour and visible in the date field before saving.
 */
export function addDuration(startMs: number, duration: BannerDuration): number {
  const d = new Date(startMs);
  if (duration === "1m") {
    d.setMonth(d.getMonth() + 1);
  } else {
    d.setDate(d.getDate() + (duration === "1w" ? 7 : 14));
  }
  return d.getTime();
}

// ── Marquee pacing ──────────────────────────────────────────────────────────

/** Scroll speed. Slow enough to read, fast enough not to feel stuck. */
export const MARQUEE_PX_PER_SECOND = 80;

/**
 * Gap trailing each copy of the text, as a fraction of the viewport width.
 * **Mirrors `--banner-marquee-gap` in App.css** - the animation translates by
 * exactly one copy (text + gap), so the two have to agree or the scroll speed
 * drifts from the intended one.
 *
 * It is viewport-proportional rather than a fixed padding so that two copies
 * always span more than the screen; otherwise a short message leaves dead space
 * on the right for part of every cycle.
 */
export const MARQUEE_GAP_RATIO = 0.6;

/** Rough advance width per character at the banner's font size. */
const MARQUEE_CHAR_PX = 8;

/**
 * Width of the gap-bullet-gap run between two announcements. **Mirrors the
 * 2.5rem flex gaps on `.banner-marquee-copy` / `.banner-marquee-item`** - the
 * cycle travels one whole copy, so an under-estimate here would speed the
 * scroll up as more announcements are added.
 */
export const MARQUEE_SEPARATOR_PX = 88;

/** Floor, so a two-word announcement doesn't whip past. */
export const MARQUEE_MIN_SECONDS = 10;

/**
 * Seconds for one full cycle, i.e. the time to travel one copy's width at a
 * constant speed - so a long announcement scrolls for longer instead of
 * scrolling faster.
 */
export function marqueeSeconds(
  text: string,
  viewportPx: number,
  separators = 0,
): number {
  const copyPx =
    text.length * MARQUEE_CHAR_PX +
    separators * MARQUEE_SEPARATOR_PX +
    viewportPx * MARQUEE_GAP_RATIO;
  return Math.max(MARQUEE_MIN_SECONDS, copyPx / MARQUEE_PX_PER_SECOND);
}
