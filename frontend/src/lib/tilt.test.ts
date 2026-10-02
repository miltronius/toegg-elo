import { describe, expect, it } from "vitest";
import { tiltFromPointer } from "./tilt";

describe("tiltFromPointer", () => {
  it("is flat with the shine centred when the pointer is in the middle", () => {
    expect(tiltFromPointer(50, 40, 100, 80, 10)).toEqual({ rx: 0, ry: 0, mx: 50, my: 50 });
  });

  it("turns the corner under the pointer towards the viewer, up to maxDeg", () => {
    // top-right: top edge forward (rx < 0), right edge forward (ry < 0)
    expect(tiltFromPointer(100, 0, 100, 80, 10)).toEqual({ rx: -10, ry: -10, mx: 100, my: 0 });
    // bottom-left
    expect(tiltFromPointer(0, 80, 100, 80, 10)).toEqual({ rx: 10, ry: 10, mx: 0, my: 100 });
  });

  it("clamps a pointer past the edge onto the card", () => {
    expect(tiltFromPointer(-30, 200, 100, 80, 8)).toEqual(tiltFromPointer(0, 80, 100, 80, 8));
  });

  it("reads a zero-sized card as flat", () => {
    expect(tiltFromPointer(5, 5, 0, 0, 10)).toEqual({ rx: 0, ry: 0, mx: 50, my: 50 });
  });
});
