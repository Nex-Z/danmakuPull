import { mkdir } from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";
import {
  DEFAULT_SETTINGS,
  APP_DB_FILE
} from "@shared/constants";
import type {
  AppSettings,
  DanmakuItem,
  FetchJob,
  FetchRangeRequest,
  OverlaySession,
  PlatformCredentials,
  PlatformId,
  PlaybackChunk,
  ResourceSelection
} from "@shared/types";
import { AppDatabase } from "./db";
import {
  fetchBilibiliChunks,
  fetchTencentChunks,
  resolveSelectionToResource,
  searchPlatform
} from "./platform-adapters";

const DEFAULT_BILI_SEGMENT_MS = 6 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function deepMerge<T extends Record<string, unknown>>(
  base: T,
  patch: Partial<T>
): T {
  const output = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      output[key] &&
      typeof output[key] === "object" &&
      !Array.isArray(output[key])
    ) {
      output[key] = deepMerge(
        output[key] as Record<string, unknown>,
        value as Record<string, unknown>
      );
    } else if (value !== undefined) {
      output[key] = value;
    }
  }
  return output as T;
}

export class DesktopAppService {
  private readonly db: AppDatabase;

  private readonly activeJobs = new Map<number, { cancelled: boolean }>();

  constructor() {
    const userData = app.getPath("userData");
    this.db = new AppDatabase(path.join(userData, APP_DB_FILE));
  }

  async initialize() {
    await mkdir(this.getSettings().cacheRoot, { recursive: true });
  }

  getSettings(): AppSettings {
    const userData = app.getPath("userData");
    const defaults: AppSettings = {
      cacheRoot: path.join(userData, DEFAULT_SETTINGS.cacheDirName),
      overlay: {
        boundsPreset: DEFAULT_SETTINGS.overlay.boundsPreset,
        contentScale: DEFAULT_SETTINGS.overlay.contentScale,
        alwaysOnTop: DEFAULT_SETTINGS.overlay.alwaysOnTop,
        opacity: DEFAULT_SETTINGS.overlay.opacity
      },
      bilibili: {
        referer: DEFAULT_SETTINGS.bilibili.referer,
        requestIntervalMs: DEFAULT_SETTINGS.bilibili.requestIntervalMs,
        maxEmptySegments: DEFAULT_SETTINGS.bilibili.maxEmptySegments,
        prefetchSegments: DEFAULT_SETTINGS.bilibili.prefetchSegments
      },
      tencent: {
        referer: DEFAULT_SETTINGS.tencent.referer,
        requestIntervalMs: DEFAULT_SETTINGS.tencent.requestIntervalMs,
        windowMs: DEFAULT_SETTINGS.tencent.windowMs,
        prefetchWindows: DEFAULT_SETTINGS.tencent.prefetchWindows,
        startMs: DEFAULT_SETTINGS.tencent.startMs
      }
    };
    return this.db.getSetting<AppSettings>("app", defaults);
  }

  updateSettings(partial: Partial<AppSettings>) {
    const merged = deepMerge(this.getSettings(), partial);
    this.db.setSetting("app", merged);
    return merged;
  }

  getCredentials(platform: PlatformId): PlatformCredentials {
    const settings = this.getSettings();
    const fallback: PlatformCredentials = {
      cookie: "",
      userAgent: "",
      referer:
        platform === "bilibili"
          ? settings.bilibili.referer
          : settings.tencent.referer
    };
    const row = this.db.getCredential(platform);
    if (!row) {
      return fallback;
    }

    try {
      return {
        ...fallback,
        ...this.decryptCredentials(row.payload)
      };
    } catch {
      return fallback;
    }
  }

  setCredentials(
    platform: PlatformId,
    payload: Partial<PlatformCredentials>
  ) {
    const next = {
      ...this.getCredentials(platform),
      ...payload
    };
    this.db.setCredential(platform, this.encryptCredentials(next));
    return next;
  }

  async testCredentials(platform: PlatformId) {
    const credentials = this.getCredentials(platform);
    try {
      const result = await searchPlatform(platform, "速度与激情", credentials);
      return {
        ok: result.items.length > 0,
        message:
          result.items.length > 0
            ? `验证成功，返回 ${result.items.length} 条候选结果。`
            : "请求成功，但没有返回候选结果。"
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async search(input: { platform: PlatformId; keyword: string }) {
    const credentials = this.getCredentials(input.platform);
    const result = await searchPlatform(
      input.platform,
      input.keyword,
      credentials
    );
    this.db.addSearchHistory(
      input.platform,
      input.keyword,
      result.items.length,
      result
    );
    return result;
  }

  async saveResource(selection: ResourceSelection) {
    const credentials = this.getCredentials(selection.platform);
    const resolved = await resolveSelectionToResource(selection, credentials);
    return this.db.upsertResource(resolved);
  }

  listResources() {
    return this.db.listResources();
  }

  deleteResource(resourceId: number) {
    this.db.deleteResource(resourceId);
  }

  listFetchJobs() {
    return this.db.listFetchJobs();
  }

  cancelFetch(jobId: number) {
    const active = this.activeJobs.get(jobId);
    if (active) {
      active.cancelled = true;
    }
    this.db.updateFetchJob(jobId, {
      status: "cancelled",
      message: "用户已取消抓取任务。"
    });
  }

  async startFetch(input: {
    resourceId: number;
    range?: FetchRangeRequest;
  }): Promise<FetchJob> {
    const job = this.db.createFetchJob(input.resourceId, input.range ?? {});
    const controller = { cancelled: false };
    this.activeJobs.set(job.id, controller);

    void this.runFetchJob(job.id, input.resourceId, input.range ?? {}, controller)
      .finally(() => {
        this.activeJobs.delete(job.id);
      });

    return job;
  }

  async ensureInitialPlayback(resourceId: number) {
    const resource = this.requireResource(resourceId);
    if (resource.cacheSummary.chunks === 0) {
      await this.fetchIntoCache(resourceId, {});
    }
  }

  async loadInitial(resourceId: number): Promise<PlaybackChunk> {
    await this.ensureInitialPlayback(resourceId);
    const resource = this.requireResource(resourceId);
    const rows = this.db.getAllDanmaku(resourceId);
    return this.mapRowsToPlaybackChunk(resource, rows);
  }

  async loadRange(input: {
    resourceId: number;
    startMs: number;
    endMs: number;
  }): Promise<PlaybackChunk> {
    const resource = this.requireResource(input.resourceId);
    let rows = this.db.getDanmakuRange(
      input.resourceId,
      input.startMs,
      input.endMs
    );
    if (rows.length === 0 || resource.cacheSummary.maxTimeMs < input.endMs) {
      await this.fetchIntoCache(input.resourceId, {
        startMs: input.startMs,
        endMs: input.endMs
      });
      rows = this.db.getDanmakuRange(
        input.resourceId,
        input.startMs,
        input.endMs
      );
    }
    return this.mapRowsToPlaybackChunk(
      this.requireResource(input.resourceId),
      rows
    );
  }

  saveSession(session: OverlaySession) {
    this.db.saveOverlaySession({
      ...session,
      updatedAt: nowIso()
    });
  }

  loadSession(resourceId: number) {
    return this.db.loadOverlaySession(resourceId);
  }

  private async runFetchJob(
    jobId: number,
    resourceId: number,
    range: FetchRangeRequest,
    controller: { cancelled: boolean }
  ) {
    try {
      this.db.updateFetchJob(jobId, {
        status: "running",
        progress: 0.1,
        message: "开始抓取弹幕缓存。"
      });

      if (controller.cancelled) {
        return;
      }

      await this.fetchIntoCache(resourceId, range);

      if (controller.cancelled) {
        this.db.updateFetchJob(jobId, {
          status: "cancelled",
          progress: 1,
          message: "抓取已取消。"
        });
        return;
      }

      this.db.updateFetchJob(jobId, {
        status: "completed",
        progress: 1,
        message: "抓取完成。"
      });
    } catch (error) {
      this.db.updateFetchJob(jobId, {
        status: "failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async fetchIntoCache(resourceId: number, range: FetchRangeRequest) {
    const resource = this.requireResource(resourceId);
    const settings = this.getSettings();
    const credentials = this.getCredentials(resource.platform);

    if (resource.platform === "bilibili") {
      const latestChunkKey = this.db.getLatestChunkKey(resourceId);
      const inferredSegment = latestChunkKey
        ? Number(latestChunkKey.replace("segment_", "")) + 1
        : 1;
      const startSegmentIndex =
        range.startSegmentIndex ??
        Math.max(
          1,
          range.startMs
            ? Math.floor(range.startMs / DEFAULT_BILI_SEGMENT_MS) + 1
            : inferredSegment
        );
      const segmentCount = Math.max(
        1,
        range.segmentCount ?? settings.bilibili.prefetchSegments
      );

      const chunks = await fetchBilibiliChunks({
        resourceId,
        resourceTitle: resource.title,
        meta: resource.meta,
        cacheRoot: settings.cacheRoot,
        credentials,
        settings: settings.bilibili,
        startSegmentIndex,
        segmentCount
      });

      for (const chunk of chunks) {
        if (this.db.hasChunk(resourceId, chunk.chunkKey)) {
          continue;
        }
        this.db.saveChunk({
          resourceId,
          chunkKey: chunk.chunkKey,
          startMs: chunk.startMs,
          endMs: chunk.endMs,
          payloadPath: chunk.payloadPath,
          rawPath: chunk.rawPath,
          items: chunk.items
        });
      }
      return;
    }

    const latestEnd = this.db.getLatestChunkEnd(resourceId);
    const startMs =
      range.startMs ??
      (latestEnd > 0 ? latestEnd : settings.tencent.startMs);
    const endMs =
      range.endMs ??
      startMs + settings.tencent.windowMs * settings.tencent.prefetchWindows;
    const neededWindows = Math.max(
      1,
      range.windowCount ??
        Math.ceil((endMs - startMs) / settings.tencent.windowMs)
    );

    const chunks = await fetchTencentChunks({
      resourceId,
      resourceTitle: resource.title,
      meta: resource.meta,
      cacheRoot: settings.cacheRoot,
      credentials,
      settings: settings.tencent,
      startMs,
      windowCount: neededWindows
    });

    for (const chunk of chunks) {
      if (this.db.hasChunk(resourceId, chunk.chunkKey)) {
        continue;
      }
      this.db.saveChunk({
        resourceId,
        chunkKey: chunk.chunkKey,
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        payloadPath: chunk.payloadPath,
        rawPath: chunk.rawPath,
        items: chunk.items
      });
    }
  }

  private requireResource(resourceId: number) {
    const resource = this.db.getResourceById(resourceId);
    if (!resource) {
      throw new Error(`资源 ${resourceId} 不存在`);
    }
    return resource;
  }

  private mapRowsToPlaybackChunk(
    resource: ReturnType<DesktopAppService["requireResource"]>,
    rows: ReturnType<AppDatabase["getAllDanmaku"]> | ReturnType<AppDatabase["getDanmakuRange"]>
  ): PlaybackChunk {
    const items: DanmakuItem[] = rows.map((row) => ({
      id: row.item_id,
      resourceId: resource.id,
      platform: row.platform as PlatformId,
      timeMs: row.time_ms,
      content: row.content,
      mode: row.mode,
      color: row.color,
      fontSize: row.font_size,
      sourceRange: {
        startMs: row.start_ms,
        endMs: row.end_ms,
        chunkKey: row.chunk_key
      },
      raw: JSON.parse(row.payload_json) as Record<string, unknown>
    }));

    const minTimeMs = items.length > 0 ? items[0].timeMs : 0;
    const maxTimeMs =
      items.length > 0 ? items[items.length - 1].timeMs : resource.cacheSummary.maxTimeMs;

    return {
      resource,
      items,
      minTimeMs,
      maxTimeMs,
      stats: {
        chunkCount: resource.cacheSummary.chunks,
        itemCount: resource.cacheSummary.danmakuItems,
        cachedUntilMs: resource.cacheSummary.maxTimeMs
      }
    };
  }

  private encryptCredentials(payload: PlatformCredentials) {
    const raw = Buffer.from(JSON.stringify(payload), "utf8");
    if (safeStorage.isEncryptionAvailable()) {
      return `safe:${safeStorage.encryptString(raw.toString("utf8")).toString("base64")}`;
    }
    return `plain:${raw.toString("base64")}`;
  }

  private decryptCredentials(payload: string): PlatformCredentials {
    if (payload.startsWith("safe:")) {
      const encrypted = Buffer.from(payload.slice(5), "base64");
      return JSON.parse(safeStorage.decryptString(encrypted)) as PlatformCredentials;
    }
    if (payload.startsWith("plain:")) {
      return JSON.parse(
        Buffer.from(payload.slice(6), "base64").toString("utf8")
      ) as PlatformCredentials;
    }
    return JSON.parse(payload) as PlatformCredentials;
  }
}
