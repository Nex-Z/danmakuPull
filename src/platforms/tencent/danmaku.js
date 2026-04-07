const DEFAULT_CONFIG = Object.freeze({
    vid: "p0046u5fcwo",
    startMs: 5910000,
    windowMs: 30000,
    requestIntervalMs: 2000,
    randomJitterMs: 0,
    previewLimit: 20,
    referer: "https://v.qq.com/",
    baseUrl: "https://dm.video.qq.com/barrage/segment",
    headers: {}
});

function resolveFetch(fetchImpl) {
    const activeFetch = fetchImpl ?? globalThis.fetch;
    if (typeof activeFetch !== "function") {
        throw new Error("当前环境没有可用的 fetch，请通过 config.fetchImpl 传入实现");
    }
    return activeFetch;
}

function cloneHeaders(headers) {
    return Object.assign({}, headers || {});
}

function normalizeInteger(value, fallback, minValue) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return fallback;
    }
    return Math.max(minValue, Math.floor(numericValue));
}

function logWith(logger, method, ...args) {
    if (!logger || typeof logger[method] !== "function") {
        return;
    }
    logger[method](...args);
}

function sleep(ms) {
    if (!ms || ms <= 0) {
        return Promise.resolve();
    }
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmtMs(ms) {
    const totalMs = Math.max(0, Number(ms) || 0);
    const totalSeconds = Math.floor(totalMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = totalMs % 1000;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
    }

    return `${minutes}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function normalizeConfig(options = {}) {
    return {
        vid: String(options.vid ?? DEFAULT_CONFIG.vid),
        startMs: normalizeInteger(options.startMs ?? DEFAULT_CONFIG.startMs, DEFAULT_CONFIG.startMs, 0),
        windowMs: normalizeInteger(options.windowMs ?? DEFAULT_CONFIG.windowMs, DEFAULT_CONFIG.windowMs, 1),
        requestIntervalMs: normalizeInteger(
            options.requestIntervalMs ?? DEFAULT_CONFIG.requestIntervalMs,
            DEFAULT_CONFIG.requestIntervalMs,
            0
        ),
        randomJitterMs: normalizeInteger(
            options.randomJitterMs ?? DEFAULT_CONFIG.randomJitterMs,
            DEFAULT_CONFIG.randomJitterMs,
            0
        ),
        previewLimit: normalizeInteger(options.previewLimit ?? DEFAULT_CONFIG.previewLimit, DEFAULT_CONFIG.previewLimit, 0),
        referer: options.referer ?? DEFAULT_CONFIG.referer,
        baseUrl: options.baseUrl ?? DEFAULT_CONFIG.baseUrl,
        headers: cloneHeaders(options.headers ?? DEFAULT_CONFIG.headers),
        logger: options.logger ?? console,
        fetchImpl: resolveFetch(options.fetchImpl)
    };
}

function buildBarrageSegmentUrl(vid, startMs, endMs, baseUrl = DEFAULT_CONFIG.baseUrl) {
    const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, "");
    return `${normalizedBaseUrl}/${encodeURIComponent(String(vid))}/t/v1/${startMs}/${endMs}`;
}

function buildRequestHeaders(config) {
    const headers = cloneHeaders(config.headers);
    if (!headers.Referer && !headers.referer && config.referer) {
        headers.Referer = config.referer;
    }
    return headers;
}

function normalizeBarrageItem(item, windowMeta) {
    const progressMs = Number(item?.time_offset);
    const upCount = Number(item?.up_count);
    const createTime = Number(item?.create_time);

    return {
        id: item?.id ? String(item.id) : "",
        content: item?.content ?? "",
        progressMs: Number.isFinite(progressMs) ? progressMs : null,
        time: Number.isFinite(progressMs) ? fmtMs(progressMs) : "",
        upCount: Number.isFinite(upCount) ? upCount : null,
        createTime: Number.isFinite(createTime) ? createTime : null,
        nick: item?.nick ?? "",
        vuid: item?.vuid ?? "",
        hotType: item?.hot_type ?? null,
        isOp: item?.is_op ?? null,
        contentScore: item?.content_score ?? null,
        windowStartMs: windowMeta.startMs,
        windowEndMs: windowMeta.endMs,
        raw: item
    };
}

function buildPreviewRows(result, previewLimit) {
    if (!Array.isArray(result.barrages) || previewLimit <= 0) {
        return [];
    }
    return result.barrages.slice(0, previewLimit).map((item, index) => ({
        index,
        time: item.time,
        upCount: item.upCount,
        nick: item.nick,
        content: item.content
    }));
}

// 腾讯视频弹幕接口按时间窗口切片：
// /barrage/segment/{vid}/t/v1/{startMs}/{endMs}
// 当前实现会保留原始 JSON 文本，并额外产出一份归一化后的弹幕数组。
async function fetchBarrageSegment(options = {}) {
    const config = normalizeConfig(options);
    const startMs = normalizeInteger(options.startMs ?? config.startMs, config.startMs, 0);
    const endMs = normalizeInteger(options.endMs ?? startMs + config.windowMs, startMs + config.windowMs, startMs + 1);
    const url = buildBarrageSegmentUrl(config.vid, startMs, endMs, config.baseUrl);

    logWith(config.logger, "log", `[腾讯弹幕] 请求 URL: ${url}`);

    const response = await config.fetchImpl(url, {
        method: "GET",
        headers: buildRequestHeaders(config)
    });

    if (!response.ok) {
        throw new Error(`腾讯弹幕请求失败: HTTP ${response.status}`);
    }

    const sourceText = await response.text();
    const bodyBytes = Buffer.byteLength(sourceText, "utf8");

    let sourceJson;
    try {
        sourceJson = JSON.parse(sourceText);
    } catch (error) {
        throw new Error(`腾讯弹幕响应不是合法 JSON: ${error.message}`);
    }

    const list = Array.isArray(sourceJson?.barrage_list) ? sourceJson.barrage_list : [];
    const barrages = list.map((item) => normalizeBarrageItem(item, {startMs, endMs}));
    const result = {
        vid: config.vid,
        startMs,
        endMs,
        url,
        fetchedAt: new Date().toISOString(),
        bodyBytes,
        sourceText,
        sourceJson,
        barrages
    };

    logWith(config.logger, "log", `[腾讯弹幕] ${fmtMs(startMs)} ~ ${fmtMs(endMs)} 成功，${barrages.length} 条，body=${bodyBytes} bytes`);
    const previewRows = buildPreviewRows(result, config.previewLimit);
    if (previewRows.length > 0 && typeof config.logger?.table === "function") {
        config.logger.table(previewRows);
    }

    return result;
}

async function fetchBarrageWindows(options = {}, windowCount = 1) {
    const config = normalizeConfig(options);
    const normalizedWindowCount = normalizeInteger(windowCount, 1, 1);
    const results = [];
    let currentStartMs = config.startMs;

    for (let index = 0; index < normalizedWindowCount; index += 1) {
        const currentEndMs = currentStartMs + config.windowMs;
        const result = await fetchBarrageSegment({
            ...config,
            startMs: currentStartMs,
            endMs: currentEndMs
        });
        results.push(result);
        currentStartMs = currentEndMs;

        if (index + 1 < normalizedWindowCount) {
            const jitterMs = config.randomJitterMs > 0
                ? Math.floor(Math.random() * (config.randomJitterMs + 1))
                : 0;
            await sleep(config.requestIntervalMs + jitterMs);
        }
    }

    return results;
}

module.exports = {
    buildBarrageSegmentUrl,
    fetchBarrageSegment,
    fetchBarrageWindows,
    fmtMs
};
