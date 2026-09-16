import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Banner, Season } from "../lib/supabase";
import { marqueeSeconds, visibleBanners } from "../lib/banners";
import { bannerDisplayText } from "../lib/bannerText";
import { useTurntable } from "../hooks/useTurntable";

interface MessageBannerProps {
  banners: Banner[];
  seasons: Season[];
  signedIn: boolean;
}

/**
 * How often visibility is re-evaluated. A window opening or closing changes
 * nothing in the database, so no realtime event announces it - without this
 * tick a scheduled banner would only appear on the next page load. 30s is fine
 * for schedules an admin sets to the minute.
 */
const TICK_MS = 30_000;

/**
 * Announcements are separate elements with a CSS gap rather than one joined
 * string: HTML collapses runs of spaces, so padding a text separator with extra
 * spaces does nothing. See `.banner-marquee-copy` in App.css for the spacing.
 */
const SEPARATOR_BULLET = "•";

/** Fallback when there is no window to measure (jsdom, first paint). */
const FALLBACK_VIEWPORT_PX = 1200;

/**
 * Repeats of the text inside the track. Three, because a cycle shifts the track
 * left by one copy and the remaining `MARQUEE_COPIES - 1` have to still cover
 * the screen; with two, a short announcement leaves the right edge blank once
 * per cycle. See the `.banner-marquee-track` comment in App.css.
 */
const MARQUEE_COPIES = 3;

/**
 * The scrolling announcement bar.
 *
 * Everything visible is folded into a single line of text scrolling right to
 * left, rather than a stack or a rotating carousel: one moving strip is what
 * reads as "the banner", and it costs no vertical space per extra message.
 *
 * The strip is repeated `MARQUEE_COPIES` times inside the track and the
 * animation translates by exactly one copy, which makes the loop seamless. Only
 * the first copy is exposed to assistive tech, so an announcement is read once.
 *
 * The strip can also be grabbed and scratched like a record - see
 * `useTurntable`.
 */
export function MessageBanner({
  banners,
  seasons,
  signedIn,
}: MessageBannerProps) {
  const { t } = useTranslation();

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const messages = useMemo(
    () =>
      visibleBanners(banners, now, signedIn)
        .map((banner) => bannerDisplayText(banner, seasons, t))
        // A season banner pointing at a season we don't have resolves to "";
        // drop it rather than render an empty slot between separators.
        .filter(Boolean),
    [banners, seasons, signedIn, now, t],
  );

  const viewportPx =
    typeof window === "undefined" ? FALLBACK_VIEWPORT_PX : window.innerWidth;
  // Rounded here rather than when formatted, so the scratch hand-back resumes
  // against the duration the animation actually runs at.
  const durationSeconds =
    Math.round(
      marqueeSeconds(
        messages.join(""),
        viewportPx,
        Math.max(0, messages.length - 1),
      ) * 10,
    ) / 10;

  const trackRef = useRef<HTMLDivElement>(null);
  const turntable = useTurntable(trackRef, MARQUEE_COPIES, durationSeconds);

  if (messages.length === 0) return null;

  return (
    <div
      className="message-banner"
      role="region"
      aria-label={t("banner.label")}
      {...turntable}
    >
      <span className="message-banner-icon" aria-hidden="true">
        📣
      </span>
      <div className="banner-marquee">
        <div
          ref={trackRef}
          className="banner-marquee-track"
          style={{ animationDuration: `${durationSeconds}s` }}
        >
          {Array.from({ length: MARQUEE_COPIES }, (_, i) => (
            <span
              key={i}
              className="banner-marquee-copy"
              aria-hidden={i > 0 || undefined}
            >
              {messages.map((message, m) => (
                <span key={m} className="banner-marquee-item">
                  {m > 0 && (
                    <span className="banner-marquee-sep" aria-hidden="true">
                      {SEPARATOR_BULLET}
                    </span>
                  )}
                  {message}
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
