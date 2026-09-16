import { describe, it, expect } from "vitest";
import {
  coast,
  hasSettled,
  isFlick,
  offsetFromTransform,
  releaseVelocity,
  resumeDelaySeconds,
  slipNeedle,
  wrapOffset,
} from "./turntable";

describe("wrapOffset", () => {
  it("keeps an offset inside one copy of the strip", () => {
    expect(wrapOffset(250, 1000)).toBe(250);
    expect(wrapOffset(1250, 1000)).toBe(250);
  });

  it("wraps a backwards drag past the start round to the end", () => {
    expect(wrapOffset(-250, 1000)).toBe(750);
  });

  it("stays at 0 before the strip has been laid out", () => {
    expect(wrapOffset(250, 0)).toBe(0);
  });
});

describe("offsetFromTransform", () => {
  it("reads how far the running animation has moved the strip left", () => {
    expect(offsetFromTransform("matrix(1, 0, 0, 1, -250, 0)", 1000)).toBe(250);
  });

  it("wraps a translation longer than one copy", () => {
    expect(offsetFromTransform("matrix(1, 0, 0, 1, -1250.5, 0)", 1000)).toBe(
      250.5,
    );
  });

  it("treats no transform as the start of the strip", () => {
    expect(offsetFromTransform("none", 1000)).toBe(0);
    expect(offsetFromTransform("", 1000)).toBe(0);
  });
});

describe("releaseVelocity", () => {
  it("measures the hand's speed over the last moments before release", () => {
    // The first sample is outside the window; including it would average the
    // flick down to ~105 px/s.
    const samples = [
      { time: 0, offset: 0 },
      { time: 900, offset: 0 },
      { time: 950, offset: 100 },
    ];
    expect(releaseVelocity(samples, 950)).toBe(2000);
  });

  it("reads a backwards flick as negative", () => {
    const samples = [
      { time: 0, offset: 0 },
      { time: 50, offset: -100 },
    ];
    expect(releaseVelocity(samples, 50)).toBe(-2000);
  });

  it("is zero when the hand stopped before letting go", () => {
    const samples = [
      { time: 0, offset: 0 },
      { time: 50, offset: 100 },
    ];
    expect(releaseVelocity(samples, 500)).toBe(0);
  });

  it("is zero for a grab that never moved", () => {
    expect(releaseVelocity([{ time: 0, offset: 0 }], 0)).toBe(0);
    expect(releaseVelocity([], 0)).toBe(0);
  });
});

describe("isFlick", () => {
  const CRUISE = 80;

  it("lets a still release drop the strip where it is", () => {
    expect(isFlick(0, CRUISE)).toBe(false);
  });

  it("spins on from a fast release in either direction", () => {
    expect(isFlick(2000, CRUISE)).toBe(true);
    expect(isFlick(-2000, CRUISE)).toBe(true);
  });
});

describe("coast", () => {
  const CRUISE = 80;
  const FRAME = 1 / 60;

  /** Runs frames until the coast settles; returns seconds taken and speed. */
  function spin(from: number, frame = FRAME) {
    let velocity = from;
    let seconds = 0;
    while (!hasSettled(velocity, CRUISE) && seconds < 60) {
      velocity = coast(velocity, CRUISE, frame);
      seconds += frame;
    }
    return { seconds, velocity };
  }

  it("slows a flick towards normal scrolling speed", () => {
    const next = coast(2000, CRUISE, FRAME);
    expect(next).toBeLessThan(2000);
    expect(next).toBeGreaterThan(CRUISE);
  });

  it("spins a hard flick for a moment, not forever", () => {
    const { seconds } = spin(3000);
    expect(seconds).toBeGreaterThan(1);
    expect(seconds).toBeLessThan(4);
  });

  it("turns a backwards flick round to scroll forwards again", () => {
    const { velocity } = spin(-3000);
    expect(velocity).toBeGreaterThan(0);
  });

  it("coasts the same on any refresh rate", () => {
    // Two 60Hz frames must land where one 30Hz frame does, or a 144Hz screen
    // would stop a flick sooner than a 60Hz one.
    const twoFrames = coast(coast(2000, CRUISE, FRAME), CRUISE, FRAME);
    expect(twoFrames).toBeCloseTo(coast(2000, CRUISE, 2 * FRAME), 9);
  });
});

describe("hasSettled", () => {
  it("is settled only once back at normal speed", () => {
    expect(hasSettled(80, 80)).toBe(true);
    expect(hasSettled(2000, 80)).toBe(false);
  });
});

describe("resumeDelaySeconds", () => {
  it("starts the CSS animation part-way through, where the strip was left", () => {
    // A quarter of the way along a 20s cycle.
    expect(resumeDelaySeconds(250, 1000, 20)).toBe(-5);
    expect(resumeDelaySeconds(1250, 1000, 20)).toBe(-5);
  });

  it("starts from the top before the strip has been laid out", () => {
    expect(resumeDelaySeconds(250, 0, 20) + 0).toBe(0);
  });
});

describe("slipNeedle", () => {
  it("plays a drag to the right backwards", () => {
    expect(slipNeedle(0, 60, 0.1)).toBeGreaterThan(0);
    expect(slipNeedle(0, -60, 0.1)).toBeLessThan(0);
  });

  it("follows a slow drag in proportion", () => {
    expect(slipNeedle(0, 20, 0.1)).toBeCloseTo(2 * slipNeedle(0, 10, 0.1), 9);
  });

  it("slips under a fling rather than squealing ever higher", () => {
    expect(slipNeedle(0, 100_000, 0.016)).toBe(slipNeedle(0, 10_000, 0.016));
    expect(slipNeedle(0, -100_000, 0.016)).toBe(
      slipNeedle(0, -10_000, 0.016),
    );
  });

  it("caps the pitch per second, not per event", () => {
    // Otherwise a 1000Hz mouse would get a far lower ceiling than a 60Hz one.
    expect(slipNeedle(0, 100_000, 0.032)).toBeCloseTo(
      2 * slipNeedle(0, 100_000, 0.016),
      9,
    );
  });

  it("carries on from where the needle is", () => {
    expect(slipNeedle(1, 10, 0.1) - 1).toBeCloseTo(slipNeedle(0, 10, 0.1), 9);
  });
});
