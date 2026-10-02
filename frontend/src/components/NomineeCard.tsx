import { useRef, type PointerEvent, type ReactNode } from "react";
import { tiltFromPointer } from "../lib/tilt";

// Enough to read as 3D, little enough that the name stays legible mid-tilt.
const MAX_TILT_DEG = 12;
const TILT_VARS = ["--rx", "--ry", "--mx", "--my"] as const;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

interface NomineeCardProps {
  name: string;
  /** Second line under the name (season Elo, games). */
  meta: ReactNode;
  picked: boolean;
  /** Picked, but no longer eligible - drawn with a warning border. */
  stale?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/**
 * One nominee on the Season Awards ballot: a toggle button (`aria-pressed`)
 * dressed as a shiny card. With a mouse it turns to face the cursor, and a
 * shine plus a border glow follow it. The picked card gets an animated
 * rainbow border (App.css, `.nominee-card`).
 *
 * The tilt is written to CSS variables on the element, never to React state,
 * so moving the mouse costs no re-render. Touch and reduced motion get a flat
 * card; Win95 flattens it in CSS.
 */
export function NomineeCard({ name, meta, picked, stale, disabled, onClick }: NomineeCardProps) {
  // Measured on enter, while the card is still flat: measuring on every move
  // would read the tilted box and make the tilt chase itself.
  const rect = useRef<DOMRect | null>(null);

  const onPointerEnter = (e: PointerEvent<HTMLButtonElement>) => {
    rect.current = e.currentTarget.getBoundingClientRect();
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const r = rect.current;
    if (!r || e.pointerType !== "mouse" || reducedMotion()) return;
    const t = tiltFromPointer(e.clientX - r.left, e.clientY - r.top, r.width, r.height, MAX_TILT_DEG);
    const style = e.currentTarget.style;
    style.setProperty("--rx", `${t.rx}deg`);
    style.setProperty("--ry", `${t.ry}deg`);
    style.setProperty("--mx", `${t.mx}%`);
    style.setProperty("--my", `${t.my}%`);
  };
  const onPointerLeave = (e: PointerEvent<HTMLButtonElement>) => {
    rect.current = null;
    for (const v of TILT_VARS) e.currentTarget.style.removeProperty(v);
  };

  return (
    <button
      type="button"
      className={`nominee-card${stale ? " is-stale" : ""}`}
      aria-pressed={picked}
      disabled={disabled}
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <span className="nominee-avatar" aria-hidden="true">
        {initials(name)}
      </span>
      <span className="nominee-name">{name}</span>
      <span className="nominee-meta">{meta}</span>
      {picked && (
        <span className="nominee-check" aria-hidden="true">
          {stale ? "!" : "✓"}
        </span>
      )}
    </button>
  );
}
