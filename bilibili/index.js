const fs = require("node:fs/promises");
const path = require("node:path");
const {createDanmakuPump} = require("./danmaku");
const {ensureProjectEnvLoaded} = require("./env");

// 入口层只负责读取调试参数、打印摘要和落盘缓存，不承载平台协议解析逻辑。
function readStringEnv(name, fallback) {
    const value = process.env[name];
    if (value === undefined || value === "") {
        return fallback;
    }
    return value;
}

function readNumberEnv(name, fallback) {
    const value = process.env[name];
    if (value === undefined || value === "") {
        return fallback;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return fallback;
    }

    return numericValue;
}

function readRunSegmentsEnv(name, fallback) {
    const value = process.env[name];
    if (value === undefined || value === "") {
        return fallback;
    }

    if (["all", "auto", "until-empty"].includes(String(value).trim().toLowerCase())) {
        return null;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return fallback;
    }

    return numericValue;
}

function buildHeadersFromEnv() {
    const headers = {};
    const cookie = process.env.BILI_COOKIE;
    const userAgent = process.env.BILI_USER_AGENT;

    if (cookie) {
        headers.Cookie = cookie;
    }

    if (userAgent) {
        headers["User-Agent"] = userAgent;
    }

    return headers;
}

function sanitizeHeaders(headers) {
    const sanitized = {};

    for (const [key, value] of Object.entries(headers || {})) {
        if (["cookie", "authorization"].includes(key.toLowerCase())) {
            sanitized[key] = `[hidden:${String(value).length}]`;
            continue;
        }

        sanitized[key] = value;
    }

    return sanitized;
}

function getSegmentCacheDir(oid) {
    return path.resolve("cache", "bilibili", String(oid));
}

function formatSegmentBaseName(segmentIndex) {
    return `segment_${String(segmentIndex).padStart(6, "0")}`;
}

async function writeUtf8Json(filePath, value) {
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function writeBinaryFile(filePath, value) {
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, value);
}

// 每个 segment 固定落两份文件：
// 1. 原始 seg.so 二进制，便于后续离线复现或重新解析
// 2. 解析后的 JSON，便于直接消费和调试
async function cacheDanmakuResults({oid, pid, results}) {
    const cacheDir = getSegmentCacheDir(oid);

    for (const item of results) {
        if (!item.ok) {
            continue;
        }

        const baseName = formatSegmentBaseName(item.segmentIndex);
        const sourcePath = path.join(cacheDir, `${baseName}.seg.so`);
        const parsedPath = path.join(cacheDir, `${baseName}.parsed.json`);
        const legacySegmentPath = path.join(cacheDir, `${baseName}.json`);
        const legacySourceTextPath = path.join(cacheDir, `${baseName}.source.txt`);

        await writeBinaryFile(sourcePath, item.sourceBytes);
        await writeUtf8Json(parsedPath, {
            oid: String(oid),
            pid: String(pid),
            segmentIndex: item.segmentIndex,
            url: item.url,
            fetchedAt: item.fetchedAt,
            bodyBytes: item.bodyBytes,
            count: item.elems.length,
            danmakus: item.elems
        });
        console.log(`[弹幕] 已写入源文件: ${sourcePath}`);
        console.log(`[弹幕] 已写入解析文件: ${parsedPath}`);

        try {
            await fs.unlink(legacySegmentPath);
            console.log(`[弹幕] 已移除旧解析文件: ${legacySegmentPath}`);
        } catch (error) {
            if (error && error.code !== "ENOENT") {
                throw error;
            }
        }

        try {
            await fs.unlink(legacySourceTextPath);
            console.log(`[弹幕] 已移除旧源文本文件: ${legacySourceTextPath}`);
        } catch (error) {
            if (error && error.code !== "ENOENT") {
                throw error;
            }
        }
    }

    const legacyFiles = [
        path.join(cacheDir, "all.json"),
        path.join(cacheDir, "manifest.json")
    ];

    for (const legacyFile of legacyFiles) {
        try {
            await fs.unlink(legacyFile);
            console.log(`[弹幕] 已移除旧缓存文件: ${legacyFile}`);
        } catch (error) {
            if (error && error.code !== "ENOENT") {
                throw error;
            }
        }
    }

    console.log(`[弹幕] 已缓存到目录: ${cacheDir}`);
}

async function main() {
    const loadedEnvFiles = await ensureProjectEnvLoaded();
    const segmentCount = readRunSegmentsEnv("BILI_RUN_SEGMENTS", 1);
    const oid = readStringEnv("BILI_OID", "37158258607");
    const pid = readStringEnv("BILI_PID", "116315968898577");
    const pumpConfig = {
        oid,
        pid,
        startSegmentIndex: readNumberEnv("BILI_START_SEGMENT", 1),
        requestIntervalMs: readNumberEnv("BILI_REQUEST_INTERVAL_MS", 2000),
        maxEmptySegments: readNumberEnv("BILI_MAX_EMPTY_SEGMENTS", 2),
        randomJitterMs: readNumberEnv("BILI_RANDOM_JITTER_MS", 0),
        previewLimit: readNumberEnv("BILI_PRINT_LIMIT", 20),
        referer: readStringEnv("BILI_REFERER", "https://www.bilibili.com"),
        headers: buildHeadersFromEnv()
    };
    const pump = createDanmakuPump(pumpConfig);

    if (loadedEnvFiles.length > 0) {
        console.log("[弹幕] 已加载环境文件", loadedEnvFiles);
    }

    console.log("[弹幕] 执行测试", {
        ...pumpConfig,
        headers: sanitizeHeaders(pumpConfig.headers),
        runSegments: segmentCount ?? "until-empty"
    });

    const results = segmentCount === null
        ? await pump.runUntilStop()
        : await pump.runSegments(segmentCount);
    const allDanmakus = results
        .filter((item) => item.ok)
        .flatMap((item) => item.elems);
    const summary = results.map((item) => {
        if (item.ok) {
            return {
                segmentIndex: item.segmentIndex,
                ok: true,
                count: item.elems.length,
                bodyBytes: item.bodyBytes
            };
        }

        return {
            segmentIndex: item.segmentIndex,
            ok: false,
            error: item.error?.message ?? String(item.error)
        };
    });

    console.log("[弹幕] 测试结果");
    console.table(summary);
    console.log("[弹幕] 当前统计");
    const stats = pump.getStats();
    console.log(JSON.stringify(stats, null, 2));

    await cacheDanmakuResults({
        oid,
        pid,
        results
    });

    if (process.env.BILI_EXPORT_PATH) {
        const absolutePath = path.resolve(process.env.BILI_EXPORT_PATH);
        await fs.writeFile(absolutePath, JSON.stringify(allDanmakus, null, 2), "utf8");
        console.log(`[弹幕] 已导出 JSON: ${absolutePath}`);
    }
}

main().catch((error) => {
    console.error("[弹幕] 测试执行失败", error);
    process.exitCode = 1;
});
