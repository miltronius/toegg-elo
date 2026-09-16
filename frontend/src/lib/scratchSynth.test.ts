import { describe, it, expect } from "vitest";
import {
  AHH_ONSET_SECONDS,
  renderNeedle,
  synthesizeAhh,
  type NeedleState,
} from "./scratchSynth";

const peak = (samples: Float32Array, from = 0, to = samples.length) => {
  let max = 0;
  for (let i = from; i < to; i++) max = Math.max(max, Math.abs(samples[i]));
  return max;
};

describe("synthesizeAhh", () => {
  const RATE = 48_000;
  const ahh = synthesizeAhh(RATE);

  it("lasts the same time at any sample rate", () => {
    // Otherwise it plays at the wrong pitch on a 44.1kHz device.
    const at44 = synthesizeAhh(44_100);
    expect(at44.length / 44_100).toBeCloseTo(ahh.length / RATE, 3);
  });

  it("is silent up to the onset, where the needle drops", () => {
    const onset = Math.round(AHH_ONSET_SECONDS * RATE);
    expect(peak(ahh, 0, onset)).toBeLessThan(1e-3);
    // ...and speaks straight away after it, so the first push is heard.
    expect(peak(ahh, onset, onset + 0.05 * RATE)).toBeGreaterThan(0.3);
  });

  it("fades back to silence before it loops, so the seam doesn't click", () => {
    expect(peak(ahh, ahh.length - 0.01 * RATE)).toBeLessThan(1e-3);
  });

  it("is loud without clipping", () => {
    expect(peak(ahh)).toBeGreaterThan(0.8);
    expect(peak(ahh)).toBeLessThanOrEqual(1);
  });
});

describe("renderNeedle", () => {
  // A slow rate keeps the arithmetic readable; the needle's dynamics are in
  // seconds, so they don't depend on it.
  const RATE = 1000;
  const BLOCK = 128;
  /** One second of record whose value is where you are in it, 0 to 1. */
  const ramp = Float32Array.from({ length: RATE }, (_, i) => i / RATE);
  const flat = new Float32Array(RATE).fill(0.5);

  function play(
    state: NeedleState,
    target: number,
    record: Float32Array,
    seconds: number,
    render = renderNeedle,
  ) {
    const blocks: Float32Array[] = [];
    let furthest = state.position;
    for (let i = 0; i < (seconds * RATE) / BLOCK; i++) {
      const out = new Float32Array(BLOCK);
      render(state, target, record, RATE, out);
      blocks.push(out);
      furthest = Math.max(furthest, state.position);
    }
    return { blocks, furthest };
  }

  it("is silent while the record is held still", () => {
    const state = { position: 0.2, rate: 0 };
    const { blocks } = play(state, 0.2, flat, 0.5);
    expect(Math.max(...blocks.map((b) => peak(b)))).toBe(0);
    expect(state.position).toBe(0.2);
  });

  it("plays forwards towards a hand that pushed ahead", () => {
    const state = { position: 0, rate: 0 };
    const { blocks } = play(state, 0.1, flat, 0.05);
    expect(state.position).toBeGreaterThan(0);
    expect(Math.max(...blocks.map((b) => peak(b)))).toBeGreaterThan(0);
  });

  it("plays backwards towards a hand that pulled back", () => {
    const state = { position: 0.5, rate: 0 };
    play(state, 0.4, flat, 0.05);
    expect(state.position).toBeLessThan(0.5);
  });

  it("catches up with the hand without overshooting it", () => {
    const state = { position: 0, rate: 0 };
    const { blocks, furthest } = play(state, 0.1, flat, 2);
    expect(furthest).toBeLessThanOrEqual(0.1);
    expect(state.position).toBeCloseTo(0.1, 3);
    // Arrived, so quiet again.
    expect(peak(blocks[blocks.length - 1])).toBeLessThan(1e-3);
  });

  it("reads the end of the record when pulled back past its start", () => {
    // At full speed, heading backwards from a quarter-second before the start.
    const state = { position: -0.25, rate: -1 };
    const out = new Float32Array(1);
    renderNeedle(state, -0.25 - 1 / 40, ramp, RATE, out);
    expect(out[0]).toBeCloseTo(0.75, 1);
  });

  it("runs on its own, as the audio worklet runs it", () => {
    // The worklet gets this function as source text, so it must not reach for
    // anything outside its own body.
    const standalone = new Function(
      `return (${renderNeedle.toString()})`,
    )() as typeof renderNeedle;
    const own = play({ position: 0, rate: 0 }, 0.3, ramp, 0.2);
    const copied = play({ position: 0, rate: 0 }, 0.3, ramp, 0.2, standalone);
    expect(copied.blocks).toEqual(own.blocks);
  });
});
