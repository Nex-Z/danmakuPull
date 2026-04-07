import {
  MIN_OVERLAY_HEIGHT,
  MIN_OVERLAY_WIDTH
} from "./constants";
import type { OverlayBoundsPreset, WindowBounds } from "./types";

export type DisplayWorkArea = WindowBounds;

function clampSize(
  value: number,
  minValue: number,
  maxValue: number
) {
  return Math.min(maxValue, Math.max(minValue, Math.floor(value)));
}

export function computePresetBounds(
  workArea: DisplayWorkArea,
  preset: OverlayBoundsPreset
): WindowBounds {
  const full = {
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height
  };

  switch (preset) {
    case "fullscreen":
      return full;
    case "top-half":
      return {
        x: workArea.x,
        y: workArea.y,
        width: workArea.width,
        height: Math.floor(workArea.height / 2)
      };
    case "bottom-half":
      return {
        x: workArea.x,
        y: workArea.y + Math.floor(workArea.height / 2),
        width: workArea.width,
        height: Math.ceil(workArea.height / 2)
      };
    case "left-half":
      return {
        x: workArea.x,
        y: workArea.y,
        width: Math.floor(workArea.width / 2),
        height: workArea.height
      };
    case "right-half":
      return {
        x: workArea.x + Math.floor(workArea.width / 2),
        y: workArea.y,
        width: Math.ceil(workArea.width / 2),
        height: workArea.height
      };
    case "custom":
    default:
      return full;
  }
}

export function clampBoundsToWorkArea(
  bounds: WindowBounds,
  workArea: DisplayWorkArea
): WindowBounds {
  const width = clampSize(bounds.width, MIN_OVERLAY_WIDTH, workArea.width);
  const height = clampSize(bounds.height, MIN_OVERLAY_HEIGHT, workArea.height);
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;

  return {
    x: clampSize(bounds.x, workArea.x, maxX),
    y: clampSize(bounds.y, workArea.y, maxY),
    width,
    height
  };
}
