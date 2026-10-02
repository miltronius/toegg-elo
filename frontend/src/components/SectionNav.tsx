import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

export type SectionNavEntry = { id: string; labelKey: string };

interface SectionNavProps {
  /** Keep this array stable (a module constant): the scroll spy re-attaches when it changes. */
  entries: readonly SectionNavEntry[];
  /** Accessible name of the nav landmark (translation key). */
  labelKey: string;
}

// While a click-scroll is under way, the spy would flicker through every
// section it passes; hold the clicked entry until the scroll has settled.
const CLICK_LOCK_MS = 900;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

/**
 * A sticky list of contents for a long page (the Admin tab). Each entry is a
 * real `#id` link - so it still works without the script - that scrolls
 * smoothly to its section and moves focus there (sections carry
 * tabIndex={-1}). The entry for the section being read is marked
 * `aria-current`, from an IntersectionObserver.
 *
 * Shown on wide screens only; App.css hides it below the breakpoint, where
 * there's no spare column for it.
 */
export function SectionNav({ entries, labelKey }: SectionNavProps) {
  const { t } = useTranslation();
  const [active, setActive] = useState(entries[0]?.id ?? null);
  const locked = useRef(false);
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (unlockTimer.current) clearTimeout(unlockTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (records) => {
        for (const r of records) visible.set(r.target.id, r.isIntersecting);
        if (locked.current) return;
        // The first section reaching into the top part of the viewport.
        const first = entries.find((e) => visible.get(e.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "0px 0px -55% 0px" },
    );
    for (const e of entries) {
      const el = document.getElementById(e.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [entries]);

  const go = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (!target) return; // let the plain anchor do its thing
    e.preventDefault();
    locked.current = true;
    if (unlockTimer.current) clearTimeout(unlockTimer.current);
    unlockTimer.current = setTimeout(() => {
      locked.current = false;
    }, CLICK_LOCK_MS);
    setActive(id);
    target.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    target.focus({ preventScroll: true });
  };

  return (
    <nav className="section-nav" aria-label={t(labelKey)}>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              className="section-nav-link"
              aria-current={entry.id === active ? "location" : undefined}
              onClick={(e) => go(e, entry.id)}
            >
              {t(entry.labelKey)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
