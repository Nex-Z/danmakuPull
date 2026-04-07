import { describe, expect, it } from "vitest";
import {
  clampBoundsToWorkArea,
  computePresetBounds
} from "./overlay";

const workArea = {
  x: 100,
  y: 40,
  width: 1920,
  height: 1080
};

describe("computePresetBounds", () => {
  it("computes the bottom half preset", () => {
    expect(computePresetBounds(workArea, "bottom-half")).toEqual({
      x: 100,
      y: 580,
      width: 1920,
      height: 540
    });
  });

  it("computes the right half preset", () => {
    expect(computePresetBounds(workArea, "right-half")).toEqual({
      x: 1060,
      y: 40,
      width: 960,
      height: 1080
    });
  });
});

describe("clampBoundsToWorkArea", () => {
  it("clamps bounds into the visible work area", () => {
    expect(
      clampBoundsToWorkArea(
        {
          x: 10,
          y: 20,
          width: 2800,
          height: 100
        },
        workArea
      )
    ).toEqual({
      x: 100,
      y: 40,
      width: 1920,
      height: 160
    });
  });
});
