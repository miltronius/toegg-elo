/**
 * Pointer → tilt for the "shiny card" hover (the Season Awards nominee cards).
 * The card turns to face the cursor: the edge under the pointer comes towards
 * the viewer. `mx`/`my` place the shine and the border glow, in percent.
 *
 * Pure math - the component writes the result to CSS variables itself, so a
 * moving mouse never re-renders React.
 */
export type Tilt = { rx: number; ry: number; mx: number; my: number };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * `x`/`y` are relative to the card's top-left corner; positions outside the
 * card (a fast flick past the edge) are clamped onto it. A zero-sized card
 * reads as flat rather than dividing by zero.
 */
export function tiltFromPointer(
  x: number,
  y: number,
  width: number,
  height: number,
  maxDeg: number,
): Tilt {
  if (width <= 0 || height <= 0) return { rx: 0, ry: 0, mx: 50, my: 50 };
  const px = clamp01(x / width);
  const py = clamp01(y / height);
  return {
    // rotateX > 0 tips the top edge away, so a pointer near the top needs < 0.
    rx: round2((py - 0.5) * 2 * maxDeg),
    // rotateY > 0 brings the left edge forward, so a pointer on the right needs < 0.
    ry: round2((0.5 - px) * 2 * maxDeg),
    mx: round2(px * 100),
    my: round2(py * 100),
  };
}
