import { useRef, type PointerEvent } from "react";
import { tiltFromPointer } from "../lib/tilt";

const TILT_VARS = ["--rx", "--ry", "--mx", "--my"] as const;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

/**
 * Pointer handlers for a `.shiny-card` (App.css): the card turns to face a
 * mouse cursor and its shine and border glow follow it. The tilt goes to CSS
 * variables on the element, never to React state, so a moving mouse costs no
 * re-render. Touch and reduced motion stay flat; Win95 flattens it in CSS.
 */
export function useTilt<T extends HTMLElement>(maxDeg: number) {
  // Measured on enter, while the card is still flat: measuring on every move
  // would read the tilted box and make the tilt chase itself.
  const rect = useRef<DOMRect | null>(null);

  return {
    onPointerEnter: (e: PointerEvent<T>) => {
      rect.current = e.currentTarget.getBoundingClientRect();
    },
    onPointerMove: (e: PointerEvent<T>) => {
      const r = rect.current;
      if (!r || e.pointerType !== "mouse" || reducedMotion()) return;
      const t = tiltFromPointer(e.clientX - r.left, e.clientY - r.top, r.width, r.height, maxDeg);
      const style = e.currentTarget.style;
      style.setProperty("--rx", `${t.rx}deg`);
      style.setProperty("--ry", `${t.ry}deg`);
      style.setProperty("--mx", `${t.mx}%`);
      style.setProperty("--my", `${t.my}%`);
    },
    onPointerLeave: (e: PointerEvent<T>) => {
      rect.current = null;
      for (const v of TILT_VARS) e.currentTarget.style.removeProperty(v);
    },
  };
}
