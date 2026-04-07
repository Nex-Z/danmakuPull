const { randomUUID } = require("node:crypto");
const {ensureProjectEnvLoaded} = require("../shared/env");

const SEARCH_ENDPOINT = "https://pbaccess.video.qq.com/trpc.videosearch.mobile_search.MultiTerminalSearch/MbSearch?vversion_platform=2";
const DEFAULT_REFERER = "https://v.qq.com/";
const DEFAULT_ORIGIN = "https://v.qq.com";
const DEFAULT_SEARCH_VERSION = "26022601";
const DEFAULT_FRONT_VERSION = "26040703";
const DEFAULT_FEATURE_LIST = Object.freeze([
    "DEFAULT_FEFEATURE",
    "PC_SHORT_VIDEOS_WATERFALL",
    "PC_WANT_EPISODE_V2",
    "PC_WANT_EPISODE"
]);

function resolveFetch(fetchImpl) {
    const activeFetch = fetchImpl ?? globalThis.fetch;
    if (typeof activeFetch !== "function") {
        throw new Error("当前环境没有可用的 fetch，请通过 options.fetchImpl 传入实现");
    }
    return activeFetch;
}

function normalizeNonNegativeInteger(value, fallback, fieldName) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }

    const numericValue = Number(value);
    if (!Number.isInteger(numericValue) || numericValue < 0) {
        throw new Error(`${fieldName} 必须是大于等于 0 的整数`);
    }

    return numericValue;
}

function normalizePositiveInteger(value, fallback, fieldName) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }

    const numericValue = Number(value);
    if (!Number.isInteger(numericValue) || numericValue <= 0) {
        throw new Error(`${fieldName} 必须是大于 0 的整数`);
    }

    return numericValue;
}

function stripHtmlTags(value) {
    if (value === undefined || value === null) {
        return "";
    }
    return String(value).replace(/<[^>]+>/g, "").trim();
}

function normalizeCoverUrl(value) {
    if (typeof value !== "string" || value === "") {
        return "";
    }
    if (value.startsWith("//")) {
        return `https:${value}`;
    }
    return value;
}

function buildRequestHeaders(options = {}) {
    const headers = Object.assign({}, options.headers || {});
    const origin = options.origin ?? process.env.TX_ORIGIN ?? DEFAULT_ORIGIN;
    const referer = options.referer ?? process.env.TX_REFERER ?? DEFAULT_REFERER;
    const userAgent = options.userAgent ?? process.env.TX_USER_AGENT;
    const cookie = options.cookie ?? process.env.TX_COOKIE;

    if (!headers.origin && !headers.Origin && origin) {
        headers.origin = origin;
    }

    if (!headers.referer && !headers.Referer && referer) {
        headers.referer = referer;
    }

    if (!headers["User-Agent"] && !headers["user-agent"] && userAgent) {
        headers["User-Agent"] = userAgent;
    }

    if (!headers.Cookie && !headers.cookie && cookie) {
        headers.Cookie = cookie;
    }

    if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
    }

    return headers;
}

function buildSearchPayload(keyword, options = {}) {
    return {
        version: options.version ?? process.env.TX_SEARCH_VERSION ?? DEFAULT_SEARCH_VERSION,
        clientType: options.clientType ?? 1,
        filterValue: options.filterValue ?? "",
        uuid: options.uuid ?? randomUUID(),
        retry: options.retry ?? 0,
        query: keyword,
        pagenum: normalizeNonNegativeInteger(options.pageNum, 0, "pageNum"),
        isPrefetch: options.isPrefetch ?? true,
        pagesize: normalizePositiveInteger(options.pageSize, 30, "pageSize"),
        queryFrom: options.queryFrom ?? 0,
        searchDatakey: options.searchDatakey ?? "",
        transInfo: options.transInfo ?? "",
        isneedQc: options.isNeedQc ?? true,
        preQid: options.preQid ?? "",
        adClientInfo: options.adClientInfo ?? "",
        extraInfo: {
            isNewMarkLabel: "1",
            multi_terminal_pc: "1",
            themeType: "1",
            sugRelatedIds: "{}",
            appVersion: options.appVersion ?? "",
            frontVersion: options.frontVersion ?? process.env.TX_FRONT_VERSION ?? DEFAULT_FRONT_VERSION,
            ...(options.extraInfo || {})
        },
        featureList: Array.isArray(options.featureList) && options.featureList.length > 0
            ? options.featureList
            : DEFAULT_FEATURE_LIST
    };
}

async function fetchTencentSearchJson(keyword, options = {}) {
    const normalizedKeyword = String(keyword ?? "").trim();
    if (!normalizedKeyword) {
        throw new Error("keyword 不能为空");
    }

    const fetchImpl = resolveFetch(options.fetchImpl);
    const payload = buildSearchPayload(normalizedKeyword, options);
    const response = await fetchImpl(SEARCH_ENDPOINT, {
        method: "POST",
        headers: buildRequestHeaders(options),
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`腾讯搜索请求失败: HTTP ${response.status}`);
    }

    const json = await response.json();
    if (json?.ret !== 0) {
        const error = new Error(`腾讯搜索接口返回失败: ${json?.msg ?? "unknown error"} (${json?.ret ?? "no-ret"})`);
        error.code = json?.ret;
        error.response = json;
        throw error;
    }

    if (json?.data?.errcode !== 0) {
        const error = new Error(`腾讯搜索数据层返回失败: ${json?.data?.errmsg ?? "unknown error"} (${json?.data?.errcode ?? "no-errcode"})`);
        error.code = json?.data?.errcode;
        error.response = json;
        throw error;
    }

    return {
        keyword: normalizedKeyword,
        payload,
        response: json
    };
}

function normalizeSearchItem(item, searchIndex) {
    const doc = item?.doc || {};
    const videoInfo = item?.videoInfo || {};
    const videoDoc = videoInfo.videoDoc || {};
    const extraFields = videoInfo.extraFields || {};

    return {
        searchIndex,
        vid: doc.id ? String(doc.id) : "",
        title: stripHtmlTags(videoInfo.title),
        rawTitle: videoInfo.title ?? "",
        subTitle: stripHtmlTags(videoInfo.subTitle),
        rawSubTitle: videoInfo.subTitle ?? "",
        typeName: videoInfo.typeName ?? "",
        videoType: videoInfo.videoType ?? null,
        viewType: videoInfo.viewType ?? null,
        imgUrl: normalizeCoverUrl(videoInfo.imgUrl),
        views: videoInfo.views ?? "",
        year: videoInfo.year ?? null,
        checkupTime: videoInfo.checkupTime ?? "",
        area: videoInfo.area ?? "",
        uploader: videoDoc.uploader ?? "",
        durationSeconds: videoDoc.timeLong ?? null,
        positiveContentId: videoDoc.positiveContentId ? String(videoDoc.positiveContentId) : "",
        cid: videoDoc.cid ? String(videoDoc.cid) : "",
        publishDate: extraFields.publishDate ?? "",
        score: extraFields.score ?? null,
        tags: Array.isArray(extraFields.tag) ? extraFields.tag : [],
        docId: doc.id ? String(doc.id) : "",
        dataType: doc.dataType ?? null,
        raw: item
    };
}

function isVideoSearchItem(item) {
    return Boolean(
        item
        && item.doc
        && item.doc.dataType === 1
        && item.doc.id
        && item.videoInfo
    );
}

// 腾讯搜索接口的结果项里，弹幕接口需要的 vid 当前可直接从 doc.id 取得。
// 这里保留完整搜索结果，方便后续如果要补详情接口或筛选逻辑时继续复用。
async function searchVideosByKeyword(keyword, options = {}) {
    await ensureProjectEnvLoaded();

    const { payload, response, keyword: normalizedKeyword } = await fetchTencentSearchJson(keyword, options);
    const normalList = response?.data?.normalList || {};
    const rawList = Array.isArray(normalList.itemList) ? normalList.itemList : [];
    const list = rawList.filter((item) => isVideoSearchItem(item));

    return {
        keyword: normalizedKeyword,
        pageNum: payload.pagenum,
        pageSize: payload.pagesize,
        total: Number.isFinite(Number(normalList.totalNum)) ? Number(normalList.totalNum) : list.length,
        items: list.map((item, index) => normalizeSearchItem(item, index)),
        raw: response
    };
}

async function searchVideoAndGetVid(keyword, options = {}) {
    const pick = normalizeNonNegativeInteger(options.pick, 0, "pick");
    const searchResult = await searchVideosByKeyword(keyword, options);

    if (searchResult.items.length === 0) {
        throw new Error(`没有搜索到与“${searchResult.keyword}”相关的视频`);
    }

    const picked = searchResult.items[pick];
    if (!picked) {
        throw new Error(`pick 超出范围，当前只搜索到 ${searchResult.items.length} 条结果`);
    }

    if (!picked.vid) {
        throw new Error("选中的搜索结果里没有 vid");
    }

    return {
        keyword: searchResult.keyword,
        pick,
        total: searchResult.total,
        vid: picked.vid,
        title: picked.title,
        picked
    };
}

async function main() {
    const [, , keywordArg, pickArg] = process.argv;
    if (!keywordArg) {
        console.error("用法: node src/platforms/tencent/video_search.js <关键词> [pick]");
        process.exitCode = 1;
        return;
    }

    const result = await searchVideoAndGetVid(keywordArg, {
        pick: pickArg
    });
    console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
    main().catch((error) => {
        console.error("[腾讯搜索] 执行失败", error);
        process.exitCode = 1;
    });
}

module.exports = {
    searchVideoAndGetVid,
    searchVideosByKeyword
};
