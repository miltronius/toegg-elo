// ── Scratching the message banner ───────────────────────────────────────────
//
// An easter egg: the banner's strip can be grabbed and dragged like a record,
// and flicked so it spins on before easing back into its normal scroll. This
// file is the motion and needle math only; the DOM wiring is in
// `hooks/useTurntable.ts` and the sound in `scratchAudio.ts`.
//
// Positions are **offsets** in px along the strip: 0 at the start of a copy,
// growing as the text moves left (the direction it normally scrolls). The
// strip repeats, so an offset is only meaningful modulo one copy's width.
// No DOM access here.

/** How far back from release the hand's speed is measured. */
const VELOCITY_WINDOW_MS = 80;

/**
 * How far a release has to be from normal scrolling speed to spin on. Below it
 * the strip is dropped where it is, which is what lets you grab it, hold it
 * still, and read.
 */
const FLICK_MIN_PX_PER_SECOND = 150;

/** Time constant of a coast easing back to normal speed. */
const COAST_TAU_SECONDS = 0.4;

/** Close enough to normal speed to hand the strip back to CSS unnoticed. */
const SETTLE_PX_PER_SECOND = 4;

/** Hand speed that plays the record at its natural pitch. */
const SCRATCH_PX_PER_SECOND = 600;

/**
 * Fastest the needle may play, as a multiple of natural pitch. Past this a
 * fling turns into a whistle (and the linear read in `renderNeedle` aliases),
 * so the needle slips under the hand instead of keeping up.
 */
const MAX_NEEDLE_RATE = 4;

export function wrapOffset(offset: number, copyWidth: number): number {
  if (copyWidth <= 0) return 0;
  return ((offset % copyWidth) + copyWidth) % copyWidth;
}

/**
 * Where the running CSS animation has the strip, from its computed
 * `transform` - a `matrix(a, b, c, d, tx, ty)` whose `tx` is the (negative)
 * translation.
 */
export function offsetFromTransform(
  transform: string,
  copyWidth: number,
): number {
  const match = /^matrix\(([^)]*)\)$/.exec(transform.trim());
  if (!match) return 0;
  const tx = Number(match[1].split(",")[4]);
  return Number.isFinite(tx) ? wrapOffset(-tx, copyWidth) : 0;
}

export interface OffsetSample {
  /** `performance.now()` ms. */
  time: number;
  /** Unwrapped offset, so a drag across the seam doesn't read as a jump. */
  offset: number;
}

/**
 * Strip speed in px/s at the moment of release, from the samples in the last
 * `VELOCITY_WINDOW_MS`. A hand that stopped before letting go has no samples
 * left in the window, and so releases at 0 rather than at its last speed.
 */
export function releaseVelocity(samples: OffsetSample[], now: number): number {
  const recent = samples.filter((s) => now - s.time <= VELOCITY_WINDOW_MS);
  if (recent.length < 2) return 0;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const seconds = (last.time - first.time) / 1000;
  return seconds > 0 ? (last.offset - first.offset) / seconds : 0;
}

export function isFlick(velocity: number, cruise: number): boolean {
  return Math.abs(velocity - cruise) > FLICK_MIN_PX_PER_SECOND;
}

/**
 * One frame of a coast: the speed eases exponentially towards `cruise`.
 * Exponential in real time, so it runs the same at any refresh rate.
 */
export function coast(
  velocity: number,
  cruise: number,
  dtSeconds: number,
): number {
  return cruise + (velocity - cruise) * Math.exp(-dtSeconds / COAST_TAU_SECONDS);
}

export function hasSettled(velocity: number, cruise: number): boolean {
  return Math.abs(velocity - cruise) < SETTLE_PX_PER_SECOND;
}

/**
 * The `animation-delay` that restarts the CSS animation at `offset`. Negative,
 * which starts an animation part-way through its cycle.
 */
export function resumeDelaySeconds(
  offset: number,
  copyWidth: number,
  durationSeconds: number,
): number {
  if (copyWidth <= 0) return 0;
  return -(wrapOffset(offset, copyWidth) / copyWidth) * durationSeconds;
}

/**
 * Moves the needle (seconds into the record) by a strip movement of `deltaPx`
 * over `dtSeconds`, slipping once the hand outruns `MAX_NEEDLE_RATE`. The cap
 * is per second of real time so it doesn't depend on how often the pointer
 * reports.
 */
export function slipNeedle(
  needle: number,
  deltaPx: number,
  dtSeconds: number,
): number {
  const limit = MAX_NEEDLE_RATE * dtSeconds;
  const step = deltaPx / SCRATCH_PX_PER_SECOND;
  return needle + Math.max(-limit, Math.min(limit, step));
}
