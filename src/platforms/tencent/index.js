const fs = require("node:fs/promises");
const path = require("node:path");
const {ensureProjectEnvLoaded} = require("../shared/env");
const {fetchBarrageWindows, fmtMs} = require("./danmaku");

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

function buildHeadersFromEnv() {
    const headers = {};
    const cookie = process.env.TX_COOKIE;
    const userAgent = process.env.TX_USER_AGENT;

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

function getTencentCacheDir(vid) {
    return path.resolve("cache", "tencent", String(vid));
}

function formatWindowBaseName(startMs, endMs) {
    return `segment_${String(startMs).padStart(10, "0")}_${String(endMs).padStart(10, "0")}`;
}

async function writeUtf8Json(filePath, value) {
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function writeUtf8Text(filePath, value) {
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, value, "utf8");
}

// 腾讯接口当前直接返回 JSON 文本，因此源文件与解析文件都按 UTF-8 文本落盘：
// 1. .source.json 保存接口原始响应
// 2. .parsed.json 保存补充了窗口信息后的归一化结果
async function cacheTencentResults({vid, results}) {
    const cacheDir = getTencentCacheDir(vid);

    for (const item of results) {
        const baseName = formatWindowBaseName(item.startMs, item.endMs);
        const sourcePath = path.join(cacheDir, `${baseName}.source.json`);
        const parsedPath = path.join(cacheDir, `${baseName}.parsed.json`);

        await writeUtf8Text(sourcePath, item.sourceText);
        await writeUtf8Json(parsedPath, {
            vid: String(vid),
            startMs: item.startMs,
            endMs: item.endMs,
            startTime: fmtMs(item.startMs),
            endTime: fmtMs(item.endMs),
            url: item.url,
            fetchedAt: item.fetchedAt,
            bodyBytes: item.bodyBytes,
            count: item.barrages.length,
            barrages: item.barrages
        });

        console.log(`[腾讯弹幕] 已写入源文件: ${sourcePath}`);
        console.log(`[腾讯弹幕] 已写入解析文件: ${parsedPath}`);
    }

    console.log(`[腾讯弹幕] 已缓存到目录: ${cacheDir}`);
}

async function main() {
    const loadedEnvFiles = await ensureProjectEnvLoaded();
    const windowCount = readNumberEnv("TX_RUN_WINDOWS", 1);
    const vid = readStringEnv("TX_VID", "p0046u5fcwo");
    const startMs = readNumberEnv("TX_START_MS", 5910000);
    const windowMs = readNumberEnv("TX_WINDOW_MS", 30000);
    const config = {
        vid,
        startMs,
        windowMs,
        requestIntervalMs: readNumberEnv("TX_REQUEST_INTERVAL_MS", 2000),
        randomJitterMs: readNumberEnv("TX_RANDOM_JITTER_MS", 0),
        previewLimit: readNumberEnv("TX_PRINT_LIMIT", 20),
        referer: readStringEnv("TX_REFERER", "https://v.qq.com/"),
        headers: buildHeadersFromEnv()
    };

    if (loadedEnvFiles.length > 0) {
        console.log("[腾讯弹幕] 已加载环境文件", loadedEnvFiles);
    }

    console.log("[腾讯弹幕] 执行测试", {
        ...config,
        headers: sanitizeHeaders(config.headers),
        runWindows: windowCount
    });

    const results = await fetchBarrageWindows(config, windowCount);
    const allBarrages = results.flatMap((item) => item.barrages);
    const summary = results.map((item) => ({
        startMs: item.startMs,
        endMs: item.endMs,
        window: `${fmtMs(item.startMs)} ~ ${fmtMs(item.endMs)}`,
        count: item.barrages.length,
        bodyBytes: item.bodyBytes
    }));

    console.log("[腾讯弹幕] 测试结果");
    console.table(summary);

    await cacheTencentResults({
        vid,
        results
    });

    if (process.env.TX_EXPORT_PATH) {
        const absolutePath = path.resolve(process.env.TX_EXPORT_PATH);
        await fs.writeFile(absolutePath, JSON.stringify(allBarrages, null, 2), "utf8");
        console.log(`[腾讯弹幕] 已导出 JSON: ${absolutePath}`);
    }
}

main().catch((error) => {
    console.error("[腾讯弹幕] 测试执行失败", error);
    process.exitCode = 1;
});
