import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MessageBanner } from "./MessageBanner";
import type { Banner } from "../lib/banners";
import type { Season } from "../lib/supabase";

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

/** What the DB trigger writes when a season starts: no message, 14-day window. */
const seasonBanner = (o: Partial<Banner> = {}): Banner =>
  banner({
    id: "season-banner",
    message: null,
    season_id: "s2",
    starts_at: iso(-DAY_MS),
    ends_at: iso(13 * DAY_MS),
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
    started_at: iso(-DAY_MS),
    ended_at: null,
    is_active: true,
    created_at: iso(-DAY_MS),
  },
];

function setup(
  props: Partial<React.ComponentProps<typeof MessageBanner>> = {},
) {
  return render(
    <MessageBanner
      banners={[]}
      seasons={SEASONS}
      signedIn={false}
      {...props}
    />,
  );
}

/** The one visible copy; the duplicate that makes the loop seamless is hidden. */
const marqueeText = () => screen.getByRole("region").textContent ?? "";

describe("MessageBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is nothing to announce", () => {
    setup();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("shows a live admin banner", () => {
    setup({ banners: [banner()] });
    expect(marqueeText()).toContain("Tournament on Friday");
  });

  it("stays silent for a banner whose window hasn't opened", () => {
    setup({ banners: [banner({ starts_at: iso(DAY_MS) })] });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("translates a season banner that has no stored message", () => {
    setup({ banners: [seasonBanner()] });
    expect(marqueeText()).toContain("Summer Slam");
  });

  it("shows an admin's override instead of the translated season text", () => {
    setup({ banners: [seasonBanner({ message: "Season 2 - fight!" })] });
    const text = marqueeText();
    expect(text).toContain("Season 2 - fight!");
    expect(text).not.toContain("Summer Slam");
  });

  it("reverts to the translation when an override is cleared to blank", () => {
    setup({ banners: [seasonBanner({ message: "   " })] });
    expect(marqueeText()).toContain("Summer Slam");
  });

  it("skips a season banner whose season is missing, without a stray separator", () => {
    setup({ banners: [seasonBanner({ season_id: "gone" }), banner()] });
    expect(marqueeText()).not.toContain("•");
  });

  it("stops announcing the season once its window has closed", () => {
    setup({ banners: [seasonBanner({ ends_at: iso(-DAY_MS) })] });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("lets an admin hide the season banner like any other", () => {
    setup({ banners: [seasonBanner({ is_active: false })] });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("joins several announcements into one strip, newest first", () => {
    setup({
      banners: [
        seasonBanner({ created_at: iso(-3 * DAY_MS) }),
        banner({ created_at: iso(-1) }),
      ],
    });
    const text = marqueeText();
    expect(text.indexOf("Tournament on Friday")).toBeLessThan(
      text.indexOf("Summer Slam"),
    );
  });

  it("withholds a members-only banner from logged-out visitors", () => {
    const members = [banner({ audience: "members" })];
    const { unmount } = setup({ banners: members, signedIn: false });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    unmount();

    setup({ banners: members, signedIn: true });
    expect(marqueeText()).toContain("Tournament on Friday");
  });

  it("reads the announcement out once, repeating it only to fill the loop", () => {
    const { container } = setup({ banners: [banner()] });
    const copies = container.querySelectorAll(".banner-marquee-copy");
    // Three, so the strip still covers the screen after a cycle shifts it left
    // by one copy - however short the message is.
    expect(copies).toHaveLength(3);
    expect(copies[0]).not.toHaveAttribute("aria-hidden");
    expect(copies[1]).toHaveAttribute("aria-hidden", "true");
    expect(copies[2]).toHaveAttribute("aria-hidden", "true");
  });

  it("reveals a scheduled banner once its window opens, with no refetch", () => {
    setup({ banners: [banner({ starts_at: iso(60_000) })] });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();

    // Nothing changes in the database when a window opens, so the component's
    // own tick is the only thing that can surface it.
    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    expect(marqueeText()).toContain("Tournament on Friday");
  });

  it("paces the scroll so a longer announcement takes longer per cycle", () => {
    const { container, rerender } = setup({
      banners: [banner({ message: "Short" })],
    });
    const track = () =>
      container.querySelector(".banner-marquee-track") as HTMLElement;
    const shortDuration = parseFloat(track().style.animationDuration);

    rerender(
      <MessageBanner
        banners={[
          banner({ message: "A very much longer announcement ".repeat(20) }),
        ]}
        seasons={SEASONS}
        signedIn={false}
      />,
    );
    expect(parseFloat(track().style.animationDuration)).toBeGreaterThan(
      shortDuration,
    );
  });
});

describe("MessageBanner scratching", () => {
  // performance.now() drives the hand's speed; jsdom does no layout, so the
  // track claims three copies of 1000px.
  let clock = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(3000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const bar = () => screen.getByRole("region");
  const trackOf = (container: HTMLElement) =>
    container.querySelector(".banner-marquee-track") as HTMLElement;

  it("takes hold of the strip and moves it with the hand", () => {
    const { container } = setup({ banners: [banner()] });
    fireEvent.pointerDown(bar(), { pointerId: 1, button: 0, clientX: 500 });
    expect(bar()).toHaveAttribute("data-scratching");

    clock = 16;
    fireEvent.pointerMove(bar(), { pointerId: 1, clientX: 400 });
    // Dragged left, the way the text scrolls.
    expect(trackOf(container).style.transform).toBe("translateX(-100px)");
  });

  it("drops the strip back into its scroll where it was let go", () => {
    const { container } = setup({ banners: [banner()] });
    fireEvent.pointerDown(bar(), { pointerId: 1, button: 0, clientX: 500 });
    clock = 16;
    fireEvent.pointerMove(bar(), { pointerId: 1, clientX: 400 });
    // Held still for a moment before letting go: no flick.
    clock = 500;
    fireEvent.pointerUp(bar(), { pointerId: 1, clientX: 400 });

    const track = trackOf(container);
    expect(bar()).not.toHaveAttribute("data-scratching");
    expect(track.style.transform).toBe("");
    // 100px into a 1000px copy: the animation resumes a tenth of the way in.
    const cycle = parseFloat(track.style.animationDuration);
    expect(parseFloat(track.style.animationDelay)).toBeCloseTo(-cycle / 10, 3);
  });

  it("spins on after a flick instead of stopping dead", () => {
    setup({ banners: [banner()] });
    fireEvent.pointerDown(bar(), { pointerId: 1, button: 0, clientX: 500 });
    clock = 20;
    fireEvent.pointerMove(bar(), { pointerId: 1, clientX: 300 });
    fireEvent.pointerUp(bar(), { pointerId: 1, clientX: 300 });
    expect(bar()).toHaveAttribute("data-scratching");
  });

  it("stays put for anyone who asked for less motion", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    try {
      setup({ banners: [banner()] });
      fireEvent.pointerDown(bar(), { pointerId: 1, button: 0, clientX: 500 });
      expect(bar()).not.toHaveAttribute("data-scratching");
    } finally {
      // @ts-expect-error jsdom has no matchMedia of its own to restore.
      delete window.matchMedia;
    }
  });
});
