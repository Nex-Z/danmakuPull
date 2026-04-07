export const APP_NAME = "Danmaku Pull Client";
export const APP_DB_FILE = "danmaku-client.sqlite";
export const HOTSPOT_HEIGHT = 52;
export const TOOLBAR_AUTO_HIDE_MS = 2000;
export const MIN_OVERLAY_WIDTH = 480;
export const MIN_OVERLAY_HEIGHT = 160;

export const CONTENT_SCALES = [0.75, 1, 1.25, 1.5, 2] as const;
export const OVERLAY_PRESETS = [
  "fullscreen",
  "top-half",
  "bottom-half",
  "left-half",
  "right-half",
  "custom"
] as const;

export const DEFAULT_SETTINGS = {
  cacheDirName: "cache",
  overlay: {
    boundsPreset: "bottom-half",
    contentScale: 1,
    alwaysOnTop: true,
    opacity: 1
  },
  bilibili: {
    referer: "https://www.bilibili.com",
    requestIntervalMs: 2000,
    maxEmptySegments: 2,
    prefetchSegments: 3
  },
  tencent: {
    referer: "https://v.qq.com/",
    requestIntervalMs: 2000,
    windowMs: 30000,
    prefetchWindows: 2,
    startMs: 0
  }
} as const;
