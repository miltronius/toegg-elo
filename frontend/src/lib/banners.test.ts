import { describe, it, expect } from "vitest";
import {
  MARQUEE_MIN_SECONDS,
  MARQUEE_PX_PER_SECOND,
  MARQUEE_SEPARATOR_PX,
  addDuration,
  bannerStatus,
  moveItem,
  orderBanners,
  forAudience,
  maskSwissDateTime,
  parseSwissDateTime,
  isGeneratedSeasonBanner,
  marqueeSeconds,
  toSwissDateTime,
  visibleBanners,
  type Banner,
} from "./banners";

const DAY_MS = 86_400_000;
const NOW = Date.parse("2026-08-02T12:00:00Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

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
  created_at: iso(-DAY_MS),
  updated_at: iso(-DAY_MS),
  ...o,
});

describe("bannerStatus", () => {
  it("is live when active with no window at all", () => {
    expect(bannerStatus(banner(), NOW)).toBe("live");
  });

  it("is live inside its window", () => {
    const b = banner({ starts_at: iso(-DAY_MS), ends_at: iso(DAY_MS) });
    expect(bannerStatus(b, NOW)).toBe("live");
  });

  it("is scheduled before the window opens", () => {
    expect(bannerStatus(banner({ starts_at: iso(DAY_MS) }), NOW)).toBe("scheduled");
  });

  it("is expired once the window closes, ends_at exclusive", () => {
    expect(bannerStatus(banner({ ends_at: iso(0) }), NOW)).toBe("expired");
    expect(bannerStatus(banner({ ends_at: iso(1) }), NOW)).toBe("live");
  });

  it("opens exactly at starts_at", () => {
    expect(bannerStatus(banner({ starts_at: iso(0) }), NOW)).toBe("live");
    expect(bannerStatus(banner({ starts_at: iso(1) }), NOW)).toBe("scheduled");
  });

  it("is hidden when switched off, even inside the window", () => {
    const b = banner({ is_active: false, starts_at: iso(-DAY_MS), ends_at: iso(DAY_MS) });
    expect(bannerStatus(b, NOW)).toBe("hidden");
  });

  it("reports expired ahead of scheduled for a window fully in the past", () => {
    const b = banner({ starts_at: iso(-2 * DAY_MS), ends_at: iso(-DAY_MS) });
    expect(bannerStatus(b, NOW)).toBe("expired");
  });

  it("treats an unparseable bound as no bound rather than throwing", () => {
    expect(bannerStatus(banner({ starts_at: "not a date" }), NOW)).toBe("live");
    expect(bannerStatus(banner({ ends_at: "not a date" }), NOW)).toBe("live");
  });
});

describe("forAudience", () => {
  it("lets an everyone banner through either way", () => {
    expect(forAudience(banner(), false)).toBe(true);
    expect(forAudience(banner(), true)).toBe(true);
  });

  it("holds a members banner back from logged-out visitors", () => {
    const b = banner({ audience: "members" });
    expect(forAudience(b, false)).toBe(false);
    expect(forAudience(b, true)).toBe(true);
  });
});

describe("visibleBanners", () => {
  it("keeps only the live ones", () => {
    const live = banner({ id: "live" });
    const hidden = banner({ id: "hidden", is_active: false });
    const future = banner({ id: "future", starts_at: iso(DAY_MS) });
    const past = banner({ id: "past", ends_at: iso(-DAY_MS) });

    expect(visibleBanners([live, hidden, future, past], NOW, true).map((b) => b.id)).toEqual([
      "live",
    ]);
  });

  it("filters by audience", () => {
    const all = banner({ id: "all" });
    const members = banner({ id: "members", audience: "members" });

    expect(visibleBanners([all, members], NOW, false).map((b) => b.id)).toEqual(["all"]);
    expect(visibleBanners([all, members], NOW, true).map((b) => b.id)).toEqual([
      "all",
      "members",
    ]);
  });

  it("puts the newest announcement first", () => {
    const old = banner({ id: "old", created_at: iso(-3 * DAY_MS) });
    const recent = banner({ id: "recent", created_at: iso(-1) });
    const middle = banner({ id: "middle", created_at: iso(-DAY_MS) });

    expect(visibleBanners([old, recent, middle], NOW, true).map((b) => b.id)).toEqual([
      "recent",
      "middle",
      "old",
    ]);
  });

  it("returns nothing for an empty list", () => {
    expect(visibleBanners([], NOW, true)).toEqual([]);
  });
});

describe("orderBanners", () => {
  it("falls back to newest-first while everything sits at 0", () => {
    const old = banner({ id: "old", created_at: iso(-3 * DAY_MS) });
    const recent = banner({ id: "recent", created_at: iso(-1) });
    expect(orderBanners([old, recent]).map((b) => b.id)).toEqual(["recent", "old"]);
  });

  it("puts a hand-set order ahead of the created_at fallback", () => {
    const first = banner({ id: "first", sort_order: 1, created_at: iso(-3 * DAY_MS) });
    const second = banner({ id: "second", sort_order: 2, created_at: iso(-1) });
    expect(orderBanners([second, first]).map((b) => b.id)).toEqual(["first", "second"]);
  });

  it("floats a freshly created banner above a reordered list", () => {
    const placed = banner({ id: "placed", sort_order: 1, created_at: iso(-3 * DAY_MS) });
    const fresh = banner({ id: "fresh", sort_order: 0, created_at: iso(-1) });
    expect(orderBanners([placed, fresh]).map((b) => b.id)).toEqual(["fresh", "placed"]);
  });

  it("does not mutate the array it is given", () => {
    const input = [banner({ id: "a", sort_order: 2 }), banner({ id: "b", sort_order: 1 })];
    orderBanners(input);
    expect(input.map((b) => b.id)).toEqual(["a", "b"]);
  });
});

describe("moveItem", () => {
  const list = ["a", "b", "c", "d"];

  it("moves an item down", () => {
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item up", () => {
    expect(moveItem(list, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("returns the original array for a no-op, so no write is triggered", () => {
    expect(moveItem(list, 1, 1)).toBe(list);
  });

  it("returns the original array when an index is out of range", () => {
    expect(moveItem(list, -1, 2)).toBe(list);
    expect(moveItem(list, 0, 9)).toBe(list);
    expect(moveItem(list, 9, 0)).toBe(list);
  });

  it("leaves the input untouched", () => {
    moveItem(list, 0, 3);
    expect(list).toEqual(["a", "b", "c", "d"]);
  });
});

describe("addDuration", () => {
  const at = (s: string) => Date.parse(s);

  it("adds whole weeks", () => {
    expect(addDuration(at("2026-08-02T12:00:00Z"), "1w")).toBe(
      at("2026-08-09T12:00:00Z"),
    );
    expect(addDuration(at("2026-08-02T12:00:00Z"), "2w")).toBe(
      at("2026-08-16T12:00:00Z"),
    );
  });

  it("adds a calendar month, not 30 days", () => {
    // February is short, so a fixed 30 days would land in March.
    expect(addDuration(at("2026-02-10T12:00:00Z"), "1m")).toBe(
      at("2026-03-10T12:00:00Z"),
    );
  });

  it("keeps the clock time when crossing a month boundary", () => {
    const end = new Date(addDuration(at("2026-01-15T08:30:00Z"), "1m"));
    expect(end.getHours()).toBe(new Date(at("2026-01-15T08:30:00Z")).getHours());
    expect(end.getMinutes()).toBe(30);
  });
});

describe("isGeneratedSeasonBanner", () => {
  it("is true for a season banner with no stored message", () => {
    expect(isGeneratedSeasonBanner(banner({ season_id: "s2", message: null }))).toBe(true);
  });

  it("treats a blank message as not overridden, so clearing reverts", () => {
    expect(isGeneratedSeasonBanner(banner({ season_id: "s2", message: "   " }))).toBe(true);
  });

  it("is false once an admin writes their own text", () => {
    expect(isGeneratedSeasonBanner(banner({ season_id: "s2", message: "My words" }))).toBe(false);
  });

  it("is false for a hand-written banner, which has no season", () => {
    expect(isGeneratedSeasonBanner(banner())).toBe(false);
    expect(isGeneratedSeasonBanner(banner({ message: null }))).toBe(false);
  });
});

describe("maskSwissDateTime", () => {
  it("inserts the separators as digits arrive", () => {
    expect(maskSwissDateTime("0")).toBe("0");
    expect(maskSwissDateTime("03")).toBe("03");
    expect(maskSwissDateTime("038")).toBe("03.8");
    expect(maskSwissDateTime("0308")).toBe("03.08");
    expect(maskSwissDateTime("03082")).toBe("03.08.2");
    expect(maskSwissDateTime("03082026")).toBe("03.08.2026");
    expect(maskSwissDateTime("0308202618")).toBe("03.08.2026 18");
    expect(maskSwissDateTime("030820261830")).toBe("03.08.2026 18:30");
  });

  it("does not re-add a separator the user just deleted", () => {
    // Backspacing "03.08." must land on "03.08", not spring back to "03.08.".
    expect(maskSwissDateTime("03.08")).toBe("03.08");
    expect(maskSwissDateTime("03.08.2026 ")).toBe("03.08.2026");
  });

  it("is idempotent, so re-masking its own output changes nothing", () => {
    const once = maskSwissDateTime("030820261830");
    expect(maskSwissDateTime(once)).toBe(once);
  });

  it("normalises a paste in any punctuation", () => {
    expect(maskSwissDateTime("03/08/2026 18:30")).toBe("03.08.2026 18:30");
    expect(maskSwissDateTime("2026-08-03")).toBe("20.26.0803");
  });

  it("ignores letters and stray punctuation", () => {
    expect(maskSwissDateTime("abc")).toBe("");
    expect(maskSwissDateTime("..:. ")).toBe("");
    expect(maskSwissDateTime("3a8b2026")).toBe("38.20.26");
  });

  it("stops at a full timestamp rather than overflowing", () => {
    expect(maskSwissDateTime("0308202618304567")).toBe("03.08.2026 18:30");
  });

  it("produces text the parser accepts", () => {
    const parsed = parseSwissDateTime(maskSwissDateTime("030820261830"));
    expect(parsed.kind).toBe("ok");
  });
});

describe("Swiss date/time fields", () => {
  it("renders an instant in dd.mm.yyyy hh:mm", () => {
    expect(toSwissDateTime(iso(0))).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
  });

  it("round-trips to the same minute", () => {
    const back = parseSwissDateTime(toSwissDateTime(new Date(NOW).toISOString()));
    expect(back.kind).toBe("ok");
    if (back.kind !== "ok") return;
    // The field carries minute precision, so compare at that granularity.
    expect(Math.floor(Date.parse(back.iso) / 60_000)).toBe(Math.floor(NOW / 60_000));
  });

  it("reads day-first, not month-first", () => {
    // The whole point: 03.08 is 3 August, never 8 March.
    const parsed = parseSwissDateTime("03.08.2026 09:30");
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    const d = new Date(parsed.iso);
    expect(d.getDate()).toBe(3);
    expect(d.getMonth()).toBe(7);
  });

  it("treats the typed time as local wall-clock", () => {
    const parsed = parseSwissDateTime("03.08.2026 18:00");
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    expect(new Date(parsed.iso).getHours()).toBe(18);
  });

  it("defaults a bare date to midnight", () => {
    const parsed = parseSwissDateTime("03.08.2026");
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    const d = new Date(parsed.iso);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it("accepts single-digit parts and the app's own comma formatting", () => {
    expect(parseSwissDateTime("3.8.2026 9:05").kind).toBe("ok");
    expect(parseSwissDateTime("03.08.2026, 09:05").kind).toBe("ok");
  });

  it("reports a blank field as no bound rather than an error", () => {
    expect(parseSwissDateTime("").kind).toBe("empty");
    expect(parseSwissDateTime("   ").kind).toBe("empty");
    expect(toSwissDateTime(null)).toBe("");
  });

  it("rejects a date that does not exist instead of rolling it over", () => {
    // JS would happily turn 31.02 into 3 March; that must not save silently.
    expect(parseSwissDateTime("31.02.2026 10:00").kind).toBe("invalid");
    expect(parseSwissDateTime("32.01.2026").kind).toBe("invalid");
    expect(parseSwissDateTime("01.13.2026").kind).toBe("invalid");
  });

  it("rejects an impossible time", () => {
    expect(parseSwissDateTime("01.02.2026 24:00").kind).toBe("invalid");
    expect(parseSwissDateTime("01.02.2026 10:60").kind).toBe("invalid");
  });

  it("rejects other formats outright rather than guessing", () => {
    expect(parseSwissDateTime("2026-08-03T10:00").kind).toBe("invalid");
    expect(parseSwissDateTime("08/03/2026").kind).toBe("invalid");
    expect(parseSwissDateTime("nonsense").kind).toBe("invalid");
    expect(toSwissDateTime("nonsense")).toBe("");
  });
});

describe("marqueeSeconds", () => {
  it("never drops below the readable floor", () => {
    expect(marqueeSeconds("Hi", 0)).toBe(MARQUEE_MIN_SECONDS);
  });

  it("scrolls longer for longer text rather than faster", () => {
    const short = marqueeSeconds("x".repeat(200), 1200);
    const long = marqueeSeconds("x".repeat(400), 1200);
    expect(long).toBeGreaterThan(short);
  });

  it("holds a constant speed as text grows", () => {
    const a = marqueeSeconds("x".repeat(1000), 1200);
    const b = marqueeSeconds("x".repeat(2000), 1200);
    // Doubling only the text adds its own width at the same px/s.
    expect((b - a) * MARQUEE_PX_PER_SECOND).toBeCloseTo(8000, 5);
  });

  it("accounts for the gap between announcements", () => {
    // Two announcements carry one separator's worth of extra travel, so the
    // scroll keeps its speed instead of hurrying as banners are added.
    const one = marqueeSeconds("x".repeat(200), 1200, 0);
    const two = marqueeSeconds("x".repeat(200), 1200, 1);
    expect((two - one) * MARQUEE_PX_PER_SECOND).toBeCloseTo(MARQUEE_SEPARATOR_PX, 5);
  });

  it("gives a wider viewport a longer cycle, since the gap scales with it", () => {
    expect(marqueeSeconds("x".repeat(200), 2400)).toBeGreaterThan(
      marqueeSeconds("x".repeat(200), 1200),
    );
  });
});
