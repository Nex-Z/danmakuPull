const { TextDecoder } = require("node:util");

const DEFAULT_CONFIG = Object.freeze({
    oid: "37158258607",
    pid: "116315968898577",
    startSegmentIndex: 1,
    requestIntervalMs: 6 * 60 * 1000,
    maxEmptySegments: 2,
    randomJitterMs: 800,
    previewLimit: 20,
    credentials: "omit",
    referer: "https://www.bilibili.com",
    baseUrl: "https://api.bilibili.com/x/v2/dm/wbi/web/seg.so",
    headers: {}
});

const FIXED_PARAMS = Object.freeze({
    type: "1",
    pull_mode: "1",
    ps: "0"
});

const utf8Decoder = new TextDecoder("utf-8");

// 统一做数值配置归一化，避免外部传入空字符串、浮点数或非法值时把状态带坏。
function normalizeInteger(value, fallback, minValue) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return fallback;
    }
    return Math.max(minValue, Math.floor(numericValue));
}

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

function logWith(logger, method, ...args) {
    if (!logger || typeof logger[method] !== "function") {
        return;
    }
    logger[method](...args);
}

function normalizeConfig(options = {}) {
    return {
        oid: String(options.oid ?? DEFAULT_CONFIG.oid),
        pid: String(options.pid ?? DEFAULT_CONFIG.pid),
        startSegmentIndex: normalizeInteger(
            options.startSegmentIndex ?? DEFAULT_CONFIG.startSegmentIndex,
            DEFAULT_CONFIG.startSegmentIndex,
            1
        ),
        requestIntervalMs: normalizeInteger(
            options.requestIntervalMs ?? DEFAULT_CONFIG.requestIntervalMs,
            DEFAULT_CONFIG.requestIntervalMs,
            0
        ),
        maxEmptySegments: normalizeInteger(
            options.maxEmptySegments ?? DEFAULT_CONFIG.maxEmptySegments,
            DEFAULT_CONFIG.maxEmptySegments,
            1
        ),
        randomJitterMs: normalizeInteger(
            options.randomJitterMs ?? DEFAULT_CONFIG.randomJitterMs,
            DEFAULT_CONFIG.randomJitterMs,
            0
        ),
        previewLimit: normalizeInteger(
            options.previewLimit ?? DEFAULT_CONFIG.previewLimit,
            DEFAULT_CONFIG.previewLimit,
            0
        ),
        credentials: options.credentials ?? DEFAULT_CONFIG.credentials,
        referer: options.referer ?? DEFAULT_CONFIG.referer,
        baseUrl: options.baseUrl ?? DEFAULT_CONFIG.baseUrl,
        headers: cloneHeaders(options.headers ?? DEFAULT_CONFIG.headers),
        logger: options.logger ?? console,
        fetchImpl: resolveFetch(options.fetchImpl)
    };
}

function createInitialState(startSegmentIndex) {
    return {
        running: false,
        currentSegmentIndex: startSegmentIndex,
        emptyCount: 0,
        fetchedSegments: [],
        danmakus: [],
        startedAt: null
    };
}

// Bilibili 的 seg.so 是 protobuf 二进制，这里保留一个最小可用的 varint/length-delimited 解码器，
// 只覆盖当前弹幕段解析确实会用到的 wire type。
function readVarint(bytes, pos) {
    let result = 0n;
    let shift = 0n;

    while (true) {
        if (pos >= bytes.length) {
            throw new Error("varint 越界");
        }

        const currentByte = BigInt(bytes[pos++]);
        result |= (currentByte & 0x7fn) << shift;

        if (!(currentByte & 0x80n)) {
            break;
        }

        shift += 7n;
    }

    return [result, pos];
}

function readBytes(bytes, pos, len) {
    if (pos + len > bytes.length) {
        throw new Error("bytes 越界");
    }
    return [bytes.slice(pos, pos + len), pos + len];
}

function decodeUtf8(u8) {
    return utf8Decoder.decode(u8);
}

function skipField(bytes, pos, wireType) {
    if (wireType === 0) {
        return readVarint(bytes, pos)[1];
    }

    if (wireType === 2) {
        const [len, nextPos] = readVarint(bytes, pos);
        const targetPos = nextPos + Number(len);
        if (targetPos > bytes.length) {
            throw new Error("bytes 越界");
        }
        return targetPos;
    }

    throw new Error(`不支持的 wireType: ${wireType}`);
}

function colorToHex(n) {
    return `#${Number(n || 0).toString(16).padStart(6, "0")}`;
}

function fmtMs(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = ms % 1000;
    return `${minutes}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

// 单条弹幕元素的 protobuf 字段解析。
// 当前只提取后续调试和使用会用到的核心字段，未知字段统一跳过，避免协议扩展时直接报错。
function parseDanmakuElem(u8) {
    let pos = 0;
    const result = {};

    while (pos < u8.length) {
        const [tag, nextPos] = readVarint(u8, pos);
        pos = nextPos;

        const fieldNo = Number(tag >> 3n);
        const wireType = Number(tag & 0x7n);

        switch (fieldNo) {
            case 1: {
                const [value, currentPos] = readVarint(u8, pos);
                result.id = value.toString();
                pos = currentPos;
                break;
            }
            case 2: {
                const [value, currentPos] = readVarint(u8, pos);
                result.progress_ms = Number(value);
                result.time = fmtMs(result.progress_ms);
                pos = currentPos;
                break;
            }
            case 3: {
                const [value, currentPos] = readVarint(u8, pos);
                result.mode = Number(value);
                pos = currentPos;
                break;
            }
            case 4: {
                const [value, currentPos] = readVarint(u8, pos);
                result.fontsize = Number(value);
                pos = currentPos;
                break;
            }
            case 5: {
                const [value, currentPos] = readVarint(u8, pos);
                result.color_dec = Number(value);
                result.color_hex = colorToHex(value);
                pos = currentPos;
                break;
            }
            case 6: {
                const [len, lenPos] = readVarint(u8, pos);
                const [buffer, currentPos] = readBytes(u8, lenPos, Number(len));
                result.midHash = decodeUtf8(buffer);
                pos = currentPos;
                break;
            }
            case 7: {
                const [len, lenPos] = readVarint(u8, pos);
                const [buffer, currentPos] = readBytes(u8, lenPos, Number(len));
                result.content = decodeUtf8(buffer);
                pos = currentPos;
                break;
            }
            case 8: {
                const [value, currentPos] = readVarint(u8, pos);
                result.ctime = value.toString();
                pos = currentPos;
                break;
            }
            case 9: {
                const [value, currentPos] = readVarint(u8, pos);
                result.weight = Number(value);
                pos = currentPos;
                break;
            }
            case 10: {
                const [len, lenPos] = readVarint(u8, pos);
                const [buffer, currentPos] = readBytes(u8, lenPos, Number(len));
                result.action = decodeUtf8(buffer);
                pos = currentPos;
                break;
            }
            case 11: {
                const [value, currentPos] = readVarint(u8, pos);
                result.pool = Number(value);
                pos = currentPos;
                break;
            }
            case 12: {
                const [len, lenPos] = readVarint(u8, pos);
                const [buffer, currentPos] = readBytes(u8, lenPos, Number(len));
                result.idStr = decodeUtf8(buffer);
                pos = currentPos;
                break;
            }
            case 13: {
                const [value, currentPos] = readVarint(u8, pos);
                result.attr = Number(value);
                pos = currentPos;
                break;
            }
            case 22: {
                const [len, lenPos] = readVarint(u8, pos);
                const [buffer, currentPos] = readBytes(u8, lenPos, Number(len));
                result.animation = decodeUtf8(buffer);
                pos = currentPos;
                break;
            }
            default:
                pos = skipField(u8, pos, wireType);
        }
    }

    return result;
}

// 顶层响应按 field 1 重复承载单条弹幕元素，field 4/5 等元信息先忽略。
function parseDmSegMobileReply(bytes) {
    let pos = 0;
    const elems = [];

    while (pos < bytes.length) {
        const [tag, nextPos] = readVarint(bytes, pos);
        pos = nextPos;

        const fieldNo = Number(tag >> 3n);
        const wireType = Number(tag & 0x7n);

        if (fieldNo === 1 && wireType === 2) {
            const [len, lenPos] = readVarint(bytes, pos);
            const [buffer, currentPos] = readBytes(bytes, lenPos, Number(len));
            elems.push(parseDanmakuElem(buffer));
            pos = currentPos;
            continue;
        }

        pos = skipField(bytes, pos, wireType);
    }

    return elems;
}

function buildSegUrl({ oid, pid, segmentIndex, baseUrl = DEFAULT_CONFIG.baseUrl }) {
    const url = new URL(baseUrl);
    url.searchParams.set("type", FIXED_PARAMS.type);
    url.searchParams.set("oid", String(oid));
    url.searchParams.set("pid", String(pid));
    url.searchParams.set("segment_index", String(segmentIndex));
    url.searchParams.set("pull_mode", FIXED_PARAMS.pull_mode);
    url.searchParams.set("ps", FIXED_PARAMS.ps);
    return url.toString();
}

function createRequestHeaders(config) {
    const headers = cloneHeaders(config.headers);
    if (config.referer && headers.Referer === undefined && headers.referer === undefined) {
        headers.Referer = config.referer;
    }
    return headers;
}

function buildPreviewRows(elems, previewLimit) {
    const rows = elems.map((item) => ({
        segment: item.segment_index,
        time: item.time,
        mode: item.mode,
        color: item.color_hex,
        content: item.content
    }));

    if (previewLimit <= 0) {
        return rows;
    }

    return rows.slice(0, previewLimit);
}

// 这里保留的是“按 segment 拉取并累计状态”的最小对外能力。
// 当前入口只需要批量抓取和统计，因此不再暴露 start/stop/reset 这类长运行控制接口。
function createDanmakuPump(options = {}) {
    const config = normalizeConfig(options);
    const state = createInitialState(config.startSegmentIndex);

    // 只负责请求单个 segment，并把原始二进制和解析结果同时带回，便于入口层统一落盘。
    async function fetchSegment(segmentIndex) {
        const url = buildSegUrl({
            oid: config.oid,
            pid: config.pid,
            segmentIndex,
            baseUrl: config.baseUrl
        });

        logWith(config.logger, "log", `[弹幕] 请求 URL: ${url}`);

        const response = await config.fetchImpl(url, {
            method: "GET",
            credentials: config.credentials,
            headers: createRequestHeaders(config)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const bytes = new Uint8Array(await response.arrayBuffer());
        const elems = parseDmSegMobileReply(bytes).map((item) => ({
            resource_oid: config.oid,
            resource_pid: config.pid,
            segment_index: segmentIndex,
            ...item
        }));

        return {
            url,
            elems,
            bodyBytes: bytes.length,
            sourceBytes: Buffer.from(bytes)
        };
    }

    // 单步推进一个 segment：
    // 1. 请求并解析当前段
    // 2. 更新累计弹幕、空包计数和段游标
    // 3. 返回可供入口层打印和落盘的结果对象
    async function stepOnce() {
        const segmentIndex = state.currentSegmentIndex;

        try {
            const { url, elems, bodyBytes, sourceBytes } = await fetchSegment(segmentIndex);
            const fetchedAt = new Date().toISOString();

            state.fetchedSegments.push({
                segment_index: segmentIndex,
                url,
                count: elems.length,
                body_bytes: bodyBytes,
                fetched_at: fetchedAt
            });

            if (elems.length === 0) {
                state.emptyCount += 1;
                logWith(
                    config.logger,
                    "log",
                    `[弹幕] segment ${segmentIndex} 空包，body=${bodyBytes} bytes，emptyCount=${state.emptyCount}`
                );
            } else {
                state.emptyCount = 0;
                state.danmakus.push(...elems);

                logWith(
                    config.logger,
                    "log",
                    `[弹幕] segment ${segmentIndex} 成功，${elems.length} 条，body=${bodyBytes} bytes`
                );
                if (typeof config.logger?.table === "function") {
                    config.logger.table(buildPreviewRows(elems, config.previewLimit));
                }
            }

            state.currentSegmentIndex += 1;

            if (state.emptyCount >= config.maxEmptySegments) {
                logWith(config.logger, "log", "[弹幕] 连续空包达到阈值，停止继续抓取");
            }

            return {
                ok: true,
                segmentIndex,
                url,
                elems,
                bodyBytes,
                sourceBytes,
                fetchedAt,
                emptyCount: state.emptyCount
            };
        } catch (error) {
            state.currentSegmentIndex += 1;
            logWith(config.logger, "error", `[弹幕] segment ${segmentIndex} 请求失败`, error);

            return {
                ok: false,
                segmentIndex,
                error
            };
        }
    }

    async function runSegments(count = 1) {
        const total = normalizeInteger(count, 1, 1);
        const results = [];
        state.running = true;
        state.startedAt = new Date().toISOString();

        try {
            for (let index = 0; index < total; index += 1) {
                const result = await stepOnce();
                results.push(result);

                if (state.emptyCount >= config.maxEmptySegments) {
                    break;
                }
            }
        } finally {
            state.running = false;
        }

        return results;
    }

    async function runUntilStop(maxSegments = Number.POSITIVE_INFINITY) {
        const results = [];
        const numericMax = Number(maxSegments);
        const limit = Number.isFinite(numericMax) && numericMax > 0
            ? Math.floor(numericMax)
            : Number.POSITIVE_INFINITY;
        state.running = true;
        state.startedAt = new Date().toISOString();

        try {
            while (results.length < limit) {
                const result = await stepOnce();
                results.push(result);

                if (state.emptyCount >= config.maxEmptySegments) {
                    break;
                }
            }
        } finally {
            state.running = false;
        }

        return results;
    }

    function getStats() {
        return {
            oid: config.oid,
            pid: config.pid,
            running: state.running,
            currentSegmentIndex: state.currentSegmentIndex,
            totalSegmentsFetched: state.fetchedSegments.length,
            totalDanmakus: state.danmakus.length,
            emptyCount: state.emptyCount,
            startedAt: state.startedAt
        };
    }

    return {
        runSegments,
        runUntilStop,
        getStats
    };
}

module.exports = {
    createDanmakuPump
};
