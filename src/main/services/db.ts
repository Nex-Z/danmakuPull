import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  FetchJob,
  OverlaySession,
  PlatformCredentials,
  ResourceRef
} from "@shared/types";

type ResourceRow = {
  id: number;
  platform: string;
  title: string;
  subtitle: string;
  external_id: string;
  page_index: number;
  meta_json: string;
  created_at: string;
  updated_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class AppDatabase {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS credentials (
        platform TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS search_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        keyword TEXT NOT NULL,
        result_count INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS resources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        title TEXT NOT NULL,
        subtitle TEXT NOT NULL,
        external_id TEXT NOT NULL,
        page_index INTEGER NOT NULL DEFAULT 0,
        meta_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(platform, external_id, page_index)
      );

      CREATE TABLE IF NOT EXISTS fetch_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        resource_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        progress REAL NOT NULL DEFAULT 0,
        message TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(resource_id) REFERENCES resources(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS segment_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        resource_id INTEGER NOT NULL,
        chunk_key TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        payload_path TEXT NOT NULL,
        raw_path TEXT NOT NULL,
        count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(resource_id, chunk_key),
        FOREIGN KEY(resource_id) REFERENCES resources(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS danmaku_items (
        resource_id INTEGER NOT NULL,
        item_id TEXT NOT NULL,
        chunk_key TEXT NOT NULL,
        platform TEXT NOT NULL,
        time_ms INTEGER NOT NULL,
        content TEXT NOT NULL,
        mode TEXT NOT NULL,
        color TEXT NOT NULL,
        font_size INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(resource_id, item_id, chunk_key),
        FOREIGN KEY(resource_id) REFERENCES resources(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS simulation_presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS overlay_sessions (
        resource_id INTEGER PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(resource_id) REFERENCES resources(id) ON DELETE CASCADE
      );
    `);
  }

  getSetting<T>(key: string, fallback: T): T {
    const statement = this.db.prepare(
      "SELECT value_json FROM settings WHERE key = ?"
    );
    const row = statement.get(key) as { value_json: string } | undefined;
    if (!row) {
      return fallback;
    }
    return parseJson(row.value_json, fallback);
  }

  setSetting(key: string, value: unknown) {
    const statement = this.db.prepare(`
      INSERT INTO settings(key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `);
    statement.run(key, JSON.stringify(value), nowIso());
  }

  getCredential(
    platform: string
  ): { payload: string; updatedAt: string } | null {
    const statement = this.db.prepare(
      "SELECT payload, updated_at FROM credentials WHERE platform = ?"
    );
    const row = statement.get(platform) as
      | { payload: string; updated_at: string }
      | undefined;
    if (!row) {
      return null;
    }
    return {
      payload: row.payload,
      updatedAt: row.updated_at
    };
  }

  setCredential(platform: string, payload: string) {
    const statement = this.db.prepare(`
      INSERT INTO credentials(platform, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(platform) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `);
    statement.run(platform, payload, nowIso());
  }

  addSearchHistory(
    platform: string,
    keyword: string,
    resultCount: number,
    payload: unknown
  ) {
    const statement = this.db.prepare(`
      INSERT INTO search_history(platform, keyword, result_count, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    statement.run(
      platform,
      keyword,
      resultCount,
      JSON.stringify(payload),
      nowIso()
    );
  }

  upsertResource(input: {
    platform: string;
    title: string;
    subtitle: string;
    externalId: string;
    pageIndex: number;
    meta: Record<string, unknown>;
  }) {
    const timestamp = nowIso();
    const statement = this.db.prepare(`
      INSERT INTO resources(platform, title, subtitle, external_id, page_index, meta_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, external_id, page_index) DO UPDATE SET
        title = excluded.title,
        subtitle = excluded.subtitle,
        meta_json = excluded.meta_json,
        updated_at = excluded.updated_at
      RETURNING id
    `);
    const row = statement.get(
      input.platform,
      input.title,
      input.subtitle,
      input.externalId,
      input.pageIndex,
      JSON.stringify(input.meta),
      timestamp,
      timestamp
    ) as { id: number };
    return this.getResourceById(row.id);
  }

  listResources(): ResourceRef[] {
    const statement = this.db.prepare(`
      SELECT
        r.id,
        r.platform,
        r.title,
        r.subtitle,
        r.external_id,
        r.page_index,
        r.meta_json,
        r.created_at,
        r.updated_at,
        COUNT(DISTINCT sc.chunk_key) AS chunks,
        COUNT(di.item_id) AS danmaku_items,
        COALESCE(MIN(di.time_ms), 0) AS min_time_ms,
        COALESCE(MAX(di.time_ms), 0) AS max_time_ms
      FROM resources r
      LEFT JOIN segment_cache sc ON sc.resource_id = r.id
      LEFT JOIN danmaku_items di ON di.resource_id = r.id
      GROUP BY r.id
      ORDER BY r.updated_at DESC
    `);
    const rows = statement.all() as Array<
      ResourceRow & {
        chunks: number;
        danmaku_items: number;
        min_time_ms: number;
        max_time_ms: number;
      }
    >;
    return rows.map((row) => this.mapResourceRow(row));
  }

  getResourceById(id: number): ResourceRef | null {
    const statement = this.db.prepare(`
      SELECT
        r.id,
        r.platform,
        r.title,
        r.subtitle,
        r.external_id,
        r.page_index,
        r.meta_json,
        r.created_at,
        r.updated_at,
        COUNT(DISTINCT sc.chunk_key) AS chunks,
        COUNT(di.item_id) AS danmaku_items,
        COALESCE(MIN(di.time_ms), 0) AS min_time_ms,
        COALESCE(MAX(di.time_ms), 0) AS max_time_ms
      FROM resources r
      LEFT JOIN segment_cache sc ON sc.resource_id = r.id
      LEFT JOIN danmaku_items di ON di.resource_id = r.id
      WHERE r.id = ?
      GROUP BY r.id
    `);
    const row = statement.get(id) as
      | (ResourceRow & {
          chunks: number;
          danmaku_items: number;
          min_time_ms: number;
          max_time_ms: number;
        })
      | undefined;
    return row ? this.mapResourceRow(row) : null;
  }

  deleteResource(resourceId: number) {
    const statement = this.db.prepare("DELETE FROM resources WHERE id = ?");
    statement.run(resourceId);
  }

  createFetchJob(resourceId: number, payload: unknown): FetchJob {
    const timestamp = nowIso();
    const statement = this.db.prepare(`
      INSERT INTO fetch_jobs(resource_id, status, progress, message, payload_json, created_at, updated_at)
      VALUES (?, 'queued', 0, '', ?, ?, ?)
      RETURNING id
    `);
    const row = statement.get(
      resourceId,
      JSON.stringify(payload),
      timestamp,
      timestamp
    ) as { id: number };
    return this.getFetchJob(row.id)!;
  }

  updateFetchJob(
    jobId: number,
    patch: Partial<Pick<FetchJob, "status" | "progress" | "message">>
  ) {
    const current = this.getFetchJob(jobId);
    if (!current) {
      return null;
    }
    const statement = this.db.prepare(`
      UPDATE fetch_jobs
      SET status = ?, progress = ?, message = ?, updated_at = ?
      WHERE id = ?
    `);
    statement.run(
      patch.status ?? current.status,
      patch.progress ?? current.progress,
      patch.message ?? current.message,
      nowIso(),
      jobId
    );
    return this.getFetchJob(jobId);
  }

  getFetchJob(jobId: number): FetchJob | null {
    const statement = this.db.prepare(`
      SELECT id, resource_id, status, progress, message, created_at, updated_at
      FROM fetch_jobs
      WHERE id = ?
    `);
    const row = statement.get(jobId) as
      | {
          id: number;
          resource_id: number;
          status: FetchJob["status"];
          progress: number;
          message: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      resourceId: row.resource_id,
      status: row.status,
      progress: row.progress,
      message: row.message,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  listFetchJobs(): FetchJob[] {
    const statement = this.db.prepare(`
      SELECT id, resource_id, status, progress, message, created_at, updated_at
      FROM fetch_jobs
      ORDER BY updated_at DESC
      LIMIT 100
    `);
    const rows = statement.all() as Array<{
      id: number;
      resource_id: number;
      status: FetchJob["status"];
      progress: number;
      message: string;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      resourceId: row.resource_id,
      status: row.status,
      progress: row.progress,
      message: row.message,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  getLatestChunkEnd(resourceId: number) {
    const statement = this.db.prepare(`
      SELECT COALESCE(MAX(end_ms), 0) AS latest_end_ms
      FROM segment_cache
      WHERE resource_id = ?
    `);
    const row = statement.get(resourceId) as { latest_end_ms: number };
    return row.latest_end_ms ?? 0;
  }

  getLatestChunkKey(resourceId: number) {
    const statement = this.db.prepare(`
      SELECT chunk_key
      FROM segment_cache
      WHERE resource_id = ?
      ORDER BY end_ms DESC
      LIMIT 1
    `);
    const row = statement.get(resourceId) as { chunk_key: string } | undefined;
    return row?.chunk_key ?? null;
  }

  hasChunk(resourceId: number, chunkKey: string) {
    const statement = this.db.prepare(`
      SELECT 1
      FROM segment_cache
      WHERE resource_id = ? AND chunk_key = ?
      LIMIT 1
    `);
    return Boolean(statement.get(resourceId, chunkKey));
  }

  saveChunk(input: {
    resourceId: number;
    chunkKey: string;
    startMs: number;
    endMs: number;
    payloadPath: string;
    rawPath: string;
    items: Array<{
      id: string;
      platform: string;
      timeMs: number;
      content: string;
      mode: string;
      color: string;
      fontSize: number;
      raw: Record<string, unknown>;
    }>;
  }) {
    const timestamp = nowIso();
    const chunkStatement = this.db.prepare(`
      INSERT INTO segment_cache(resource_id, chunk_key, start_ms, end_ms, payload_path, raw_path, count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(resource_id, chunk_key) DO UPDATE SET
        start_ms = excluded.start_ms,
        end_ms = excluded.end_ms,
        payload_path = excluded.payload_path,
        raw_path = excluded.raw_path,
        count = excluded.count
    `);
    chunkStatement.run(
      input.resourceId,
      input.chunkKey,
      input.startMs,
      input.endMs,
      input.payloadPath,
      input.rawPath,
      input.items.length,
      timestamp
    );

    const itemStatement = this.db.prepare(`
      INSERT OR REPLACE INTO danmaku_items(
        resource_id,
        item_id,
        chunk_key,
        platform,
        time_ms,
        content,
        mode,
        color,
        font_size,
        payload_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.exec("BEGIN");
    try {
      for (const item of input.items) {
        itemStatement.run(
          input.resourceId,
          item.id,
          input.chunkKey,
          item.platform,
          item.timeMs,
          item.content,
          item.mode,
          item.color,
          item.fontSize,
          JSON.stringify(item.raw),
          timestamp
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getDanmakuRange(resourceId: number, startMs: number, endMs: number) {
    const statement = this.db.prepare(`
      SELECT
        di.item_id,
        di.platform,
        di.time_ms,
        di.content,
        di.mode,
        di.color,
        di.font_size,
        di.payload_json,
        sc.chunk_key,
        sc.start_ms,
        sc.end_ms
      FROM danmaku_items di
      INNER JOIN segment_cache sc
        ON sc.resource_id = di.resource_id
       AND sc.chunk_key = di.chunk_key
      WHERE di.resource_id = ?
        AND di.time_ms >= ?
        AND di.time_ms <= ?
      ORDER BY di.time_ms ASC, di.item_id ASC
    `);
    return statement.all(resourceId, startMs, endMs) as Array<{
      item_id: string;
      platform: string;
      time_ms: number;
      content: string;
      mode: string;
      color: string;
      font_size: number;
      payload_json: string;
      chunk_key: string;
      start_ms: number;
      end_ms: number;
    }>;
  }

  getAllDanmaku(resourceId: number) {
    const statement = this.db.prepare(`
      SELECT
        di.item_id,
        di.platform,
        di.time_ms,
        di.content,
        di.mode,
        di.color,
        di.font_size,
        di.payload_json,
        sc.chunk_key,
        sc.start_ms,
        sc.end_ms
      FROM danmaku_items di
      INNER JOIN segment_cache sc
        ON sc.resource_id = di.resource_id
       AND sc.chunk_key = di.chunk_key
      WHERE di.resource_id = ?
      ORDER BY di.time_ms ASC, di.item_id ASC
    `);
    return statement.all(resourceId) as Array<{
      item_id: string;
      platform: string;
      time_ms: number;
      content: string;
      mode: string;
      color: string;
      font_size: number;
      payload_json: string;
      chunk_key: string;
      start_ms: number;
      end_ms: number;
    }>;
  }

  saveOverlaySession(session: OverlaySession) {
    const statement = this.db.prepare(`
      INSERT INTO overlay_sessions(resource_id, payload_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(resource_id) DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `);
    statement.run(
      session.resourceId,
      JSON.stringify(session),
      nowIso()
    );
  }

  loadOverlaySession(resourceId: number): OverlaySession | null {
    const statement = this.db.prepare(`
      SELECT payload_json
      FROM overlay_sessions
      WHERE resource_id = ?
    `);
    const row = statement.get(resourceId) as
      | { payload_json: string }
      | undefined;
    if (!row) {
      return null;
    }
    return parseJson<OverlaySession | null>(row.payload_json, null);
  }

  private mapResourceRow(
    row: ResourceRow & {
      chunks: number;
      danmaku_items: number;
      min_time_ms: number;
      max_time_ms: number;
    }
  ): ResourceRef {
    return {
      id: row.id,
      platform: row.platform as ResourceRef["platform"],
      title: row.title,
      subtitle: row.subtitle,
      externalId: row.external_id,
      pageIndex: row.page_index,
      meta: parseJson(row.meta_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      cacheSummary: {
        chunks: row.chunks,
        danmakuItems: row.danmaku_items,
        minTimeMs: row.min_time_ms,
        maxTimeMs: row.max_time_ms
      }
    };
  }
}
