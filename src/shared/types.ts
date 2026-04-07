import type { CONTENT_SCALES, OVERLAY_PRESETS } from "./constants";

export type PlatformId = "bilibili" | "tencent";
export type OverlayBoundsPreset = (typeof OVERLAY_PRESETS)[number];
export type ContentScale = (typeof CONTENT_SCALES)[number];

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PlatformCredentials = {
  cookie: string;
  userAgent: string;
  referer: string;
};

export type AppSettings = {
  cacheRoot: string;
  overlay: {
    boundsPreset: OverlayBoundsPreset;
    contentScale: ContentScale;
    alwaysOnTop: boolean;
    opacity: number;
  };
  bilibili: {
    referer: string;
    requestIntervalMs: number;
    maxEmptySegments: number;
    prefetchSegments: number;
  };
  tencent: {
    referer: string;
    requestIntervalMs: number;
    windowMs: number;
    prefetchWindows: number;
    startMs: number;
  };
};

export type SearchResultItem = {
  id: string;
  platform: PlatformId;
  title: string;
  subtitle: string;
  coverUrl: string;
  metaLine: string;
  summary: string;
  raw: Record<string, unknown>;
};

export type SearchResponse = {
  platform: PlatformId;
  keyword: string;
  total: number;
  items: SearchResultItem[];
  searchedAt: string;
};

export type ResourceSelection = {
  platform: PlatformId;
  item: SearchResultItem;
  pageIndex?: number;
};

export type ResourceRef = {
  id: number;
  platform: PlatformId;
  title: string;
  subtitle: string;
  externalId: string;
  pageIndex: number;
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  cacheSummary: {
    chunks: number;
    danmakuItems: number;
    minTimeMs: number;
    maxTimeMs: number;
  };
};

export type FetchJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type FetchJob = {
  id: number;
  resourceId: number;
  status: FetchJobStatus;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
};

export type FetchRangeRequest = {
  startMs?: number;
  endMs?: number;
  startSegmentIndex?: number;
  segmentCount?: number;
  windowCount?: number;
};

export type DanmakuItem = {
  id: string;
  resourceId: number;
  platform: PlatformId;
  timeMs: number;
  content: string;
  mode: number | string;
  color: string;
  fontSize: number;
  sourceRange: {
    startMs: number;
    endMs: number;
    chunkKey: string;
  };
  raw: Record<string, unknown>;
};

export type PlaybackChunk = {
  resource: ResourceRef;
  items: DanmakuItem[];
  minTimeMs: number;
  maxTimeMs: number;
  stats: {
    chunkCount: number;
    itemCount: number;
    cachedUntilMs: number;
  };
};

export type OverlaySession = {
  resourceId: number;
  positionMs: number;
  rate: number;
  opacity: number;
  boundsPreset: OverlayBoundsPreset;
  bounds: WindowBounds;
  contentScale: ContentScale;
  displayId: number | null;
  alwaysOnTop: boolean;
  updatedAt: string;
};

export type OverlayOpenRequest = {
  resourceId: number;
  boundsPreset?: OverlayBoundsPreset;
  displayId?: number;
  autoplay?: boolean;
  contentScale?: ContentScale;
};

export type PlaybackState = {
  resourceId: number;
  positionMs: number;
  rate: number;
  paused: boolean;
  opacity: number;
  contentScale: ContentScale;
  boundsPreset: OverlayBoundsPreset;
  alwaysOnTop: boolean;
};

export type OverlayRuntimeState = {
  resourceId: number | null;
  boundsPreset: OverlayBoundsPreset;
  contentScale: ContentScale;
  alwaysOnTop: boolean;
  bounds: WindowBounds | null;
  displayId: number | null;
};

export type AppApi = {
  config: {
    get: () => Promise<AppSettings>;
    update: (partial: Partial<AppSettings>) => Promise<AppSettings>;
  };
  credentials: {
    get: (platform: PlatformId) => Promise<PlatformCredentials>;
    set: (
      platform: PlatformId,
      payload: Partial<PlatformCredentials>
    ) => Promise<PlatformCredentials>;
    test: (platform: PlatformId) => Promise<{ ok: boolean; message: string }>;
  };
  search: {
    run: (input: {
      platform: PlatformId;
      keyword: string;
    }) => Promise<SearchResponse>;
  };
  resource: {
    save: (selection: ResourceSelection) => Promise<ResourceRef>;
    list: () => Promise<ResourceRef[]>;
    delete: (resourceId: number) => Promise<void>;
  };
  fetch: {
    start: (input: {
      resourceId: number;
      range?: FetchRangeRequest;
    }) => Promise<FetchJob>;
    listJobs: () => Promise<FetchJob[]>;
    cancel: (jobId: number) => Promise<void>;
  };
  overlay: {
    open: (input: OverlayOpenRequest) => Promise<void>;
    close: () => Promise<void>;
    setBoundsPreset: (preset: OverlayBoundsPreset) => Promise<void>;
    setAlwaysOnTop: (enabled: boolean) => Promise<void>;
    setContentScale: (scale: ContentScale) => Promise<void>;
    setPassThrough: (enabled: boolean) => Promise<void>;
    getState: () => Promise<OverlayRuntimeState>;
    onState: (listener: (state: OverlayRuntimeState) => void) => () => void;
    onSignal: (
      listener: (signal: { type: "show-toolbar" | "hide-toolbar" }) => void
    ) => () => void;
  };
  playback: {
    loadInitial: (resourceId: number) => Promise<PlaybackChunk>;
    loadRange: (input: {
      resourceId: number;
      startMs: number;
      endMs: number;
    }) => Promise<PlaybackChunk>;
    loadSession: (resourceId: number) => Promise<OverlaySession | null>;
    saveSession: (session: OverlaySession) => Promise<void>;
  };
};
