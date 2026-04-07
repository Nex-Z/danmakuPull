import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type {
  AppSettings,
  PlatformCredentials,
  ResourceSelection,
  SearchResponse
} from "@shared/types";

const require = createRequire(import.meta.url);
const DEFAULT_BILI_SEGMENT_MS = 6 * 60 * 1000;

function legacyModule<T>(relativePath: string): T {
  const absolutePath = path.join(app.getAppPath(), relativePath);
  return require(absolutePath) as T;
}

function sanitizeText(value: unknown) {
  return String(value ?? "").trim();
}

function buildBilibiliOptions(credentials: PlatformCredentials) {
  return {
    cookie: credentials.cookie,
    userAgent: credentials.userAgent,
    referer: credentials.referer
  };
}

function buildTencentOptions(credentials: PlatformCredentials) {
  return {
    cookie: credentials.cookie,
    userAgent: credentials.userAgent,
    referer: credentials.referer,
    origin: "https://v.qq.com"
  };
}

export async function searchPlatform(
  platform: "bilibili" | "tencent",
  keyword: string,
  credentials: PlatformCredentials
): Promise<SearchResponse> {
  if (platform === "bilibili") {
    const { searchVideosByKeyword } = legacyModule<{
      searchVideosByKeyword: (
        keyword: string,
        options: Record<string, unknown>
      ) => Promise<{
        total: number;
        items: Array<Record<string, unknown>>;
      }>;
    }>("src/platforms/bilibili/video_search.js");

    const result = await searchVideosByKeyword(
      keyword,
      buildBilibiliOptions(credentials)
    );

    return {
      platform,
      keyword,
      total: result.total,
      searchedAt: new Date().toISOString(),
      items: result.items.map((item) => ({
        id: sanitizeText(item.bvid),
        platform,
        title: sanitizeText(item.title),
        subtitle: sanitizeText(item.author),
        coverUrl: sanitizeText(item.pic),
        metaLine: [sanitizeText(item.duration), sanitizeText(item.play)]
          .filter(Boolean)
          .join(" · "),
        summary: sanitizeText(item.description),
        raw: item
      }))
    };
  }

  const { searchVideosByKeyword } = legacyModule<{
    searchVideosByKeyword: (
      keyword: string,
      options: Record<string, unknown>
    ) => Promise<{
      total: number;
      items: Array<Record<string, unknown>>;
    }>;
  }>("src/platforms/tencent/video_search.js");

  const result = await searchVideosByKeyword(
    keyword,
    buildTencentOptions(credentials)
  );

  return {
    platform,
    keyword,
    total: result.total,
    searchedAt: new Date().toISOString(),
    items: result.items.map((item) => ({
      id: sanitizeText(item.vid),
      platform,
      title: sanitizeText(item.title),
      subtitle: sanitizeText(item.subTitle),
      coverUrl: sanitizeText(item.imgUrl),
      metaLine: [sanitizeText(item.area), sanitizeText(item.year)]
        .filter(Boolean)
        .join(" · "),
      summary: Array.isArray(item.tags)
        ? item.tags.map((tag) => sanitizeText(tag)).filter(Boolean).join(" / ")
        : "",
      raw: item
    }))
  };
}

export async function resolveSelectionToResource(
  selection: ResourceSelection,
  credentials: PlatformCredentials
) {
  if (selection.platform === "bilibili") {
    const { getVideoDetailByBvid } = legacyModule<{
      getVideoDetailByBvid: (
        bvid: string,
        options: Record<string, unknown>
      ) => Promise<Record<string, unknown>>;
    }>("src/platforms/bilibili/video_search.js");

    const bvid = sanitizeText(selection.item.raw.bvid);
    const detail = await getVideoDetailByBvid(
      bvid,
      buildBilibiliOptions(credentials)
    );
    const pages = Array.isArray(detail.pages) ? detail.pages : [];
    const safePageIndex = Math.max(
      0,
      Math.min(selection.pageIndex ?? 0, Math.max(pages.length - 1, 0))
    );
    const selectedPage =
      (pages[safePageIndex] as Record<string, unknown> | undefined) ??
      ({
        cid: detail.cid,
        page: 1,
        part: detail.title
      } satisfies Record<string, unknown>);

    return {
      platform: selection.platform,
      title: sanitizeText(detail.title) || selection.item.title,
      subtitle: `Bilibili · P${Number(selectedPage.page ?? 1)} ${sanitizeText(
        selectedPage.part
      )}`,
      externalId: sanitizeText(selectedPage.cid),
      pageIndex: safePageIndex,
      meta: {
        bvid,
        aid: sanitizeText(detail.aid || selection.item.raw.aid),
        oid: sanitizeText(selectedPage.cid),
        pid: sanitizeText(detail.aid || selection.item.raw.aid),
        pageIndex: safePageIndex,
        pageTitle: sanitizeText(selectedPage.part),
        pageCount: pages.length || 1,
        owner: detail.owner ?? null
      }
    };
  }

  return {
    platform: selection.platform,
    title: selection.item.title,
    subtitle: `Tencent Video · ${selection.item.subtitle || "视频资源"}`,
    externalId: sanitizeText(selection.item.raw.vid),
    pageIndex: 0,
    meta: {
      vid: sanitizeText(selection.item.raw.vid),
      positiveContentId: sanitizeText(selection.item.raw.positiveContentId),
      area: sanitizeText(selection.item.raw.area),
      year: sanitizeText(selection.item.raw.year)
    }
  };
}

export async function fetchBilibiliChunks(input: {
  resourceId: number;
  resourceTitle: string;
  meta: Record<string, unknown>;
  cacheRoot: string;
  credentials: PlatformCredentials;
  settings: AppSettings["bilibili"];
  startSegmentIndex: number;
  segmentCount: number;
}) {
  const { createDanmakuPump } = legacyModule<{
    createDanmakuPump: (options: Record<string, unknown>) => {
      runSegments: (count: number) => Promise<
        Array<{
          ok: boolean;
          segmentIndex: number;
          url?: string;
          elems?: Array<Record<string, unknown>>;
          bodyBytes?: number;
          sourceBytes?: Buffer;
          fetchedAt?: string;
        }>
      >;
    };
  }>("src/platforms/bilibili/danmaku.js");

  const oid = sanitizeText(input.meta.oid);
  const pid = sanitizeText(input.meta.pid);
  const pump = createDanmakuPump({
    oid,
    pid,
    startSegmentIndex: input.startSegmentIndex,
    requestIntervalMs: input.settings.requestIntervalMs,
    maxEmptySegments: input.settings.maxEmptySegments,
    randomJitterMs: 0,
    previewLimit: 0,
    referer: input.credentials.referer,
    headers: {
      Cookie: input.credentials.cookie,
      "User-Agent": input.credentials.userAgent
    }
  });

  const results = await pump.runSegments(input.segmentCount);
  const cacheDir = path.join(input.cacheRoot, "bilibili", oid);
  await mkdir(cacheDir, { recursive: true });

  const chunks: Array<{
    chunkKey: string;
    startMs: number;
    endMs: number;
    payloadPath: string;
    rawPath: string;
    items: Array<{
      id: string;
      platform: "bilibili";
      timeMs: number;
      content: string;
      mode: string;
      color: string;
      fontSize: number;
      raw: Record<string, unknown>;
    }>;
  }> = [];

  for (const result of results) {
    if (!result.ok || !result.elems || !result.url || !result.sourceBytes) {
      continue;
    }
    const baseName = `segment_${String(result.segmentIndex).padStart(6, "0")}`;
    const rawPath = path.join(cacheDir, `${baseName}.seg.so`);
    const payloadPath = path.join(cacheDir, `${baseName}.parsed.json`);
    const items = result.elems.map((item) => ({
      id: sanitizeText(item.id || item.idStr) || `${result.segmentIndex}-${Math.random()}`,
      platform: "bilibili" as const,
      timeMs: Number(item.progress_ms ?? 0),
      content: sanitizeText(item.content),
      mode: sanitizeText(item.mode),
      color: sanitizeText(item.color_hex || "#ffffff"),
      fontSize: Number(item.fontsize ?? 25),
      raw: item
    }));
    const minTimeMs = items.length > 0
      ? Math.min(...items.map((item) => item.timeMs))
      : (result.segmentIndex - 1) * DEFAULT_BILI_SEGMENT_MS;
    const maxTimeMs = items.length > 0
      ? Math.max(...items.map((item) => item.timeMs))
      : result.segmentIndex * DEFAULT_BILI_SEGMENT_MS;

    await writeFile(rawPath, result.sourceBytes);
    await writeFile(
      payloadPath,
      JSON.stringify(
        {
          resourceId: input.resourceId,
          title: input.resourceTitle,
          oid,
          pid,
          segmentIndex: result.segmentIndex,
          fetchedAt: result.fetchedAt,
          count: items.length,
          danmakus: result.elems
        },
        null,
        2
      ),
      "utf8"
    );

    chunks.push({
      chunkKey: baseName,
      startMs: minTimeMs,
      endMs: Math.max(maxTimeMs, minTimeMs + 1),
      payloadPath,
      rawPath,
      items
    });
  }

  return chunks;
}

export async function fetchTencentChunks(input: {
  resourceId: number;
  resourceTitle: string;
  meta: Record<string, unknown>;
  cacheRoot: string;
  credentials: PlatformCredentials;
  settings: AppSettings["tencent"];
  startMs: number;
  windowCount: number;
}) {
  const { fetchBarrageWindows } = legacyModule<{
    fetchBarrageWindows: (
      options: Record<string, unknown>,
      windowCount: number
    ) => Promise<
      Array<{
        vid: string;
        startMs: number;
        endMs: number;
        url: string;
        fetchedAt: string;
        sourceText: string;
        barrages: Array<Record<string, unknown>>;
      }>
    >;
  }>("src/platforms/tencent/danmaku.js");

  const vid = sanitizeText(input.meta.vid);
  const results = await fetchBarrageWindows(
    {
      vid,
      startMs: input.startMs,
      windowMs: input.settings.windowMs,
      requestIntervalMs: input.settings.requestIntervalMs,
      randomJitterMs: 0,
      previewLimit: 0,
      referer: input.credentials.referer,
      headers: {
        Cookie: input.credentials.cookie,
        "User-Agent": input.credentials.userAgent
      }
    },
    input.windowCount
  );

  const cacheDir = path.join(input.cacheRoot, "tencent", vid);
  await mkdir(cacheDir, { recursive: true });

  return Promise.all(
    results.map(async (result) => {
      const baseName = `segment_${String(result.startMs).padStart(
        10,
        "0"
      )}_${String(result.endMs).padStart(10, "0")}`;
      const rawPath = path.join(cacheDir, `${baseName}.source.json`);
      const payloadPath = path.join(cacheDir, `${baseName}.parsed.json`);
      const items = result.barrages.map((item) => ({
        id: sanitizeText(item.id) || `${result.startMs}-${Math.random()}`,
        platform: "tencent" as const,
        timeMs: Number(item.progressMs ?? item.time_offset ?? 0),
        content: sanitizeText(item.content),
        mode: "scroll",
        color: "#ffffff",
        fontSize: 24,
        raw: item
      }));

      await writeFile(rawPath, result.sourceText, "utf8");
      await writeFile(
        payloadPath,
        JSON.stringify(
          {
            resourceId: input.resourceId,
            title: input.resourceTitle,
            vid,
            startMs: result.startMs,
            endMs: result.endMs,
            fetchedAt: result.fetchedAt,
            count: items.length,
            barrages: result.barrages
          },
          null,
          2
        ),
        "utf8"
      );

      return {
        chunkKey: baseName,
        startMs: result.startMs,
        endMs: result.endMs,
        payloadPath,
        rawPath,
        items
      };
    })
  );
}
