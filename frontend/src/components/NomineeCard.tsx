import type { ReactNode } from "react";
import { useTilt } from "../hooks/useTilt";

// Enough to read as 3D, little enough that the name stays legible mid-tilt.
const MAX_TILT_DEG = 12;

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
 * dressed as a `.shiny-card` (useTilt). The picked card gets the spinning
 * rainbow border; a stale pick (no longer eligible) a warning one instead.
 */
export function NomineeCard({ name, meta, picked, stale, disabled, onClick }: NomineeCardProps) {
  const tilt = useTilt<HTMLButtonElement>(MAX_TILT_DEG);
  const glowing = picked && !stale;

  return (
    <button
      type="button"
      className={`shiny-card nominee-card${glowing ? " is-glowing" : ""}${stale ? " is-stale" : ""}`}
      aria-pressed={picked}
      disabled={disabled}
      onClick={onClick}
      {...tilt}
    >
      <span className="nominee-avatar" aria-hidden="true">
        {initials(name)}
      </span>
      <span className="nominee-name">{name}</span>
      <span className="nominee-meta">{meta}</span>
      {picked && (
        <span className="shiny-check" aria-hidden="true">
          {stale ? "!" : "✓"}
        </span>
      )}
    </button>
  );
}
