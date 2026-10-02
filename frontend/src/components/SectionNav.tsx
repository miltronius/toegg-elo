import { useEffect, useRef, useState, type MouseEvent } from "react";

export type SectionNavEntry = {
  id: string;
  label: string;
  /** Optional second line, e.g. a season's dates. */
  detail?: string;
};

interface SectionNavProps {
  entries: readonly SectionNavEntry[];
  /** Accessible name of the nav landmark. */
  label: string;
  /**
   * Called when an entry's section isn't in the DOM yet (the Timeline renders
   * older days lazily). The page renders it, and the scroll happens on the
   * next render - so this only needs to update the page's own state.
   */
  onReveal?: (id: string) => void;
}

// While a click-scroll is under way, the spy would flicker through every
// section it passes; hold the clicked entry until the scroll has settled.
const CLICK_LOCK_MS = 900;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

/**
 * A sticky list of contents for a long page (the Admin tab, the Timeline).
 * Each entry is a real `#id` link - so it still works without the script -
 * that scrolls smoothly to its section and moves focus there (sections carry
 * tabIndex={-1}). The entry for the section being read is marked
 * `aria-current`, from an IntersectionObserver.
 *
 * Shown on wide screens only; App.css hides it below the breakpoint, where
 * there's no spare column for it.
 */
export function SectionNav({ entries, label, onReveal }: SectionNavProps) {
  const [active, setActive] = useState(entries[0]?.id ?? null);
  const locked = useRef(false);
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // An entry clicked before its section existed; scrolled to once it renders.
  const pending = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (unlockTimer.current) clearTimeout(unlockTimer.current);
    },
    [],
  );

  // Re-attached after every render: a lazily rendered section (the Timeline's
  // older seasons) appears without the list of ids changing, and observing is
  // cheap next to the render that caused it. A fresh observer reports every
  // target's state at once, so nothing is lost by starting over.
  const ids = entries.map((e) => e.id);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || ids.length === 0) return;
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (records) => {
        for (const r of records) visible.set(r.target.id, r.isIntersecting);
        if (locked.current) return;
        // The first section reaching into the top part of the viewport.
        const first = ids.find((id) => visible.get(id));
        if (first) setActive(first);
      },
      { rootMargin: "0px 0px -55% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  });

  const scrollTo = (id: string): boolean => {
    const target = document.getElementById(id);
    if (!target) return false;
    target.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    target.focus({ preventScroll: true });
    return true;
  };

  // Finish a click whose section only rendered after onReveal.
  useEffect(() => {
    if (pending.current && scrollTo(pending.current)) pending.current = null;
  });

  const go = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    const exists = document.getElementById(id) !== null;
    if (!exists && !onReveal) return; // let the plain anchor do its thing
    e.preventDefault();
    locked.current = true;
    if (unlockTimer.current) clearTimeout(unlockTimer.current);
    unlockTimer.current = setTimeout(() => {
      locked.current = false;
    }, CLICK_LOCK_MS);
    setActive(id);
    if (exists) {
      scrollTo(id);
    } else {
      pending.current = id;
      onReveal?.(id);
    }
  };

  return (
    <nav className="section-nav" aria-label={label}>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              className="section-nav-link"
              aria-current={entry.id === active ? "location" : undefined}
              onClick={(e) => go(e, entry.id)}
            >
              <span className="section-nav-label">{entry.label}</span>
              {entry.detail && <span className="section-nav-detail">{entry.detail}</span>}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
