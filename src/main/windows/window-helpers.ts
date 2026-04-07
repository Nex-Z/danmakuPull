import { join } from "node:path";
import type { BrowserWindow } from "electron";

export const preloadPath = join(__dirname, "../preload/index.js");
const rendererIndexPath = join(__dirname, "../renderer/index.html");

export function loadRendererRoute(
  window: BrowserWindow,
  route: string
) {
  const normalizedRoute = route.startsWith("/") ? route : `/${route}`;
  if (process.env.ELECTRON_RENDERER_URL) {
    return window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${normalizedRoute}`);
  }

  return window.loadFile(rendererIndexPath, {
    hash: normalizedRoute
  });
}
