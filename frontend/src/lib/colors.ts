export const colors = {
  primary: "#3b82f6",
  primaryDark: "#2563eb",
  success: "#10b981",
  successLight: "#d1fae5",
  error: "#ef4444",
  errorLight: "#fee2e2",
  warning: "#f59e0b",
  text: "#1f2937",
  textLight: "#6b7280",
  bg: "#f9fafb",
  bgLight: "#f3f4f6",
  border: "#e5e7eb",
  borderLight: "#f3f4f6",
  neutral: "#aaaaaa",
} as const;

// Stable hue in [0, 360) derived from an arbitrary seed string.
export function hashHue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) & 0xffff;
  }
  return hash % 360;
}

// Converts HSL to hex so the result is always a valid hex string for
// <input type="color">, which rejects hsl().
export function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// How many categorical slots the relationship graph colours nodes with. Six is
// the measured ceiling: validated all-pairs on the light card surface (worst
// normal-vision ΔE 15.6), and past six even full-colour vision can't separate
// every pair. See --relgraph-c1..c6 in App.css for the hexes.
// slots updated to 12 to support more players in the relationship graph: update comment.
export const RELGRAPH_SLOTS = 12;
