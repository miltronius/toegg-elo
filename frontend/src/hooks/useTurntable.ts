import { useEffect, useRef } from "react";
import type { PointerEvent, RefObject } from "react";
import { scratchVoice } from "../lib/scratchAudio";
import {
  coast,
  hasSettled,
  isFlick,
  offsetFromTransform,
  releaseVelocity,
  resumeDelaySeconds,
  slipNeedle,
  wrapOffset,
  type OffsetSample,
} from "../lib/turntable";

/** Set on the bar while JS, not the CSS animation, owns the strip. */
const SCRATCHING_ATTR = "data-scratching";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
/** Enough to cover the velocity window even on a 1000Hz mouse. */
const MAX_SAMPLES = 100;

type Grip =
  | { kind: "idle" }
  | {
      kind: "held";
      pointerId: number;
      startX: number;
      grabOffset: number;
      /** Unwrapped px moved since the grab; positive is leftwards. */
      travel: number;
      needle: number;
      lastTime: number;
      samples: OffsetSample[];
    }
  | { kind: "coasting"; offset: number; velocity: number; needle: number };

/**
 * The banner's scratch easter egg: grab the strip and drag it like a record,
 * or flick it to spin on. Spread the returned handlers onto the bar.
 *
 * The CSS animation keeps running the strip in normal use. A grab reads where
 * it has got to, switches it off (`data-scratching`, see App.css) and moves the
 * strip by hand; on release it restarts the animation with a negative
 * `animation-delay` so it carries on from the same spot. `transform` and
 * `animation-delay` are written straight to the track, not through React
 * state, so a drag never re-renders - React only owns `animation-duration`.
 */
export function useTurntable(
  trackRef: RefObject<HTMLElement | null>,
  copies: number,
  durationSeconds: number,
) {
  const grip = useRef<Grip>({ kind: "idle" });
  const bar = useRef<HTMLElement | null>(null);
  const frame = useRef(0);
  const duration = useRef(durationSeconds);

  useEffect(() => {
    duration.current = durationSeconds;
  }, [durationSeconds]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const copyWidth = () => (trackRef.current?.offsetWidth ?? 0) / copies;
  const cruise = () =>
    duration.current > 0 ? copyWidth() / duration.current : 0;

  const place = (offset: number) => {
    const track = trackRef.current;
    if (!track) return;
    track.style.transform = `translateX(${-wrapOffset(offset, copyWidth())}px)`;
  };

  const handBack = (offset: number) => {
    const track = trackRef.current;
    if (track) {
      track.style.transform = "";
      track.style.animationDelay = `${resumeDelaySeconds(
        offset,
        copyWidth(),
        duration.current,
      )}s`;
    }
    bar.current?.removeAttribute(SCRATCHING_ATTR);
    grip.current = { kind: "idle" };
    scratchVoice()?.rest();
  };

  const spin = (from: number) => {
    let last = from;
    const step = (time: number) => {
      const current = grip.current;
      if (current.kind !== "coasting") return;
      // rAF's timestamp is the frame's start, which can precede the release.
      const dt = Math.max(0, (time - last) / 1000);
      last = time;

      const before = current.velocity;
      current.velocity = coast(before, cruise(), dt);
      const moved = ((before + current.velocity) / 2) * dt;
      current.offset += moved;
      current.needle = slipNeedle(current.needle, moved, dt);
      place(current.offset);
      scratchVoice()?.moveTo(current.needle);

      if (hasSettled(current.velocity, cruise())) handBack(current.offset);
      else frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };

  const release = (e: PointerEvent<HTMLElement>, mayCoast: boolean) => {
    const current = grip.current;
    if (current.kind !== "held" || e.pointerId !== current.pointerId) return;
    const now = performance.now();
    const offset = current.grabOffset + current.travel;
    // A cancelled pointer was taken by the browser (e.g. a vertical scroll on
    // touch), not flung.
    const velocity = mayCoast ? releaseVelocity(current.samples, now) : 0;

    if (!isFlick(velocity, cruise())) {
      handBack(offset);
      return;
    }
    grip.current = {
      kind: "coasting",
      offset,
      velocity,
      needle: current.needle,
    };
    scratchVoice()?.fadeOut();
    spin(now);
  };

  return {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.button !== 0 || grip.current.kind === "held") return;
      if (window.matchMedia?.(REDUCED_MOTION).matches) return;
      const track = trackRef.current;
      if (!track) return;

      cancelAnimationFrame(frame.current);
      // Read where the animation has the strip before switching it off.
      const grabOffset =
        grip.current.kind === "coasting"
          ? grip.current.offset
          : offsetFromTransform(getComputedStyle(track).transform, copyWidth());

      bar.current = e.currentTarget;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.currentTarget.setAttribute(SCRATCHING_ATTR, "");
      place(grabOffset);

      const now = performance.now();
      grip.current = {
        kind: "held",
        pointerId: e.pointerId,
        startX: e.clientX,
        grabOffset,
        travel: 0,
        needle: 0,
        lastTime: now,
        samples: [{ time: now, offset: 0 }],
      };
      scratchVoice()?.drop();
    },

    onPointerMove(e: PointerEvent<HTMLElement>) {
      const current = grip.current;
      if (current.kind !== "held" || e.pointerId !== current.pointerId) return;
      const now = performance.now();
      const travel = current.startX - e.clientX;
      // Floor the interval: two events on the same timestamp would otherwise
      // cap the needle's step at zero and swallow the movement.
      const dt = Math.max(0.001, (now - current.lastTime) / 1000);

      current.needle = slipNeedle(current.needle, travel - current.travel, dt);
      current.travel = travel;
      current.lastTime = now;
      current.samples.push({ time: now, offset: travel });
      if (current.samples.length > MAX_SAMPLES) current.samples.shift();

      place(current.grabOffset + travel);
      scratchVoice()?.moveTo(current.needle);
    },

    onPointerUp(e: PointerEvent<HTMLElement>) {
      release(e, true);
    },

    onPointerCancel(e: PointerEvent<HTMLElement>) {
      release(e, false);
    },
  };
}
