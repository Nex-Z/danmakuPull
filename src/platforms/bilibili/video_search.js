const {ensureProjectEnvLoaded} = require("../shared/env");

const DEFAULT_REFERER = "https://www.bilibili.com";
const SEARCH_ENDPOINT = "https://api.bilibili.com/x/web-interface/search/type";
const VIEW_ENDPOINT = "https://api.bilibili.com/x/web-interface/view";

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
    const referer = options.referer ?? process.env.BILI_REFERER ?? DEFAULT_REFERER;
    const userAgent = options.userAgent ?? process.env.BILI_USER_AGENT;
    const cookie = options.cookie ?? process.env.BILI_COOKIE;

    if (!headers.Referer && !headers.referer && referer) {
        headers.Referer = referer;
    }

    if (!headers["User-Agent"] && !headers["user-agent"] && userAgent) {
        headers["User-Agent"] = userAgent;
    }

    if (!headers.Cookie && !headers.cookie && cookie) {
        headers.Cookie = cookie;
    }

    return headers;
}

async function fetchBilibiliJson(url, options = {}) {
    const fetchImpl = resolveFetch(options.fetchImpl);
    const response = await fetchImpl(url, {
        method: "GET",
        headers: buildRequestHeaders(options)
    });

    if (!response.ok) {
        throw new Error(`请求失败: HTTP ${response.status}`);
    }

    const json = await response.json();
    if (json?.code !== 0) {
        const error = new Error(`Bilibili 接口返回失败: ${json?.message ?? "unknown error"} (${json?.code ?? "no-code"})`);
        error.code = json?.code;
        error.response = json;
        throw error;
    }

    return json;
}

function normalizeSearchItem(item, searchIndex) {
    return {
        searchIndex,
        title: stripHtmlTags(item?.title),
        rawTitle: item?.title ?? "",
        description: stripHtmlTags(item?.description),
        bvid: item?.bvid ? String(item.bvid) : "",
        aid: item?.aid === undefined || item?.aid === null ? null : String(item.aid),
        author: item?.author ?? "",
        mid: item?.mid === undefined || item?.mid === null ? null : String(item.mid),
        duration: item?.duration ?? "",
        play: item?.play ?? null,
        danmaku: item?.video_review ?? null,
        favorites: item?.favorites ?? null,
        review: item?.review ?? null,
        pic: normalizeCoverUrl(item?.pic),
        arcurl: item?.arcurl ?? "",
        tag: item?.tag ?? "",
        pubdate: item?.pubdate ?? null,
        raw: item
    };
}

function normalizePageItem(item, index) {
    return {
        index,
        cid: item?.cid === undefined || item?.cid === null ? null : String(item.cid),
        page: item?.page ?? index + 1,
        part: item?.part ?? "",
        duration: item?.duration ?? null,
        from: item?.from ?? "",
        firstFrame: normalizeCoverUrl(item?.first_frame),
        raw: item
    };
}

// 先走视频搜索接口拿到候选视频列表。
// 返回值保留了搜索接口原始字段，方便外部在“挑第几个结果”之前做额外判定。
async function searchVideosByKeyword(keyword, options = {}) {
    await ensureProjectEnvLoaded();

    const normalizedKeyword = String(keyword ?? "").trim();
    if (!normalizedKeyword) {
        throw new Error("keyword 不能为空");
    }

    const page = normalizePositiveInteger(options.page, 1, "page");
    const pageSize = normalizePositiveInteger(options.pageSize, 20, "pageSize");
    const searchType = options.searchType ?? "video";

    const searchUrl = new URL(SEARCH_ENDPOINT);
    searchUrl.searchParams.set("search_type", searchType);
    searchUrl.searchParams.set("keyword", normalizedKeyword);
    searchUrl.searchParams.set("page", String(page));
    searchUrl.searchParams.set("page_size", String(pageSize));

    const json = await fetchBilibiliJson(searchUrl.toString(), options);
    const list = Array.isArray(json?.data?.result) ? json.data.result : [];

    return {
        keyword: normalizedKeyword,
        page,
        pageSize,
        total: Number.isFinite(Number(json?.data?.numResults)) ? Number(json.data.numResults) : list.length,
        items: list.map((item, index) => normalizeSearchItem(item, index)),
        raw: json
    };
}

// 再走视频详情接口拿到稳定的 cid/pages[]。
// 单 P 视频通常 data.cid 即可使用；多 P 视频则优先从 data.pages[pageIndex].cid 选择目标分 P。
async function getVideoDetailByBvid(bvid, options = {}) {
    await ensureProjectEnvLoaded();

    const normalizedBvid = String(bvid ?? "").trim();
    if (!normalizedBvid) {
        throw new Error("bvid 不能为空");
    }

    const viewUrl = new URL(VIEW_ENDPOINT);
    viewUrl.searchParams.set("bvid", normalizedBvid);

    const json = await fetchBilibiliJson(viewUrl.toString(), options);
    const data = json?.data;
    if (!data) {
        throw new Error("视频详情接口未返回 data");
    }

    const pages = Array.isArray(data.pages) ? data.pages.map((item, index) => normalizePageItem(item, index)) : [];

    return {
        title: data.title ?? "",
        bvid: data.bvid ? String(data.bvid) : normalizedBvid,
        aid: data.aid === undefined || data.aid === null ? null : String(data.aid),
        cid: data.cid === undefined || data.cid === null ? null : String(data.cid),
        videos: data.videos ?? (pages.length || 1),
        desc: data.desc ?? "",
        pic: normalizeCoverUrl(data.pic),
        owner: data.owner ? {
            mid: data.owner.mid === undefined || data.owner.mid === null ? null : String(data.owner.mid),
            name: data.owner.name ?? ""
        } : null,
        pages,
        raw: data
    };
}

function resolveSelectedPage(detail, pageIndex) {
    const normalizedPageIndex = normalizeNonNegativeInteger(pageIndex, 0, "pageIndex");

    if (detail.pages.length > 0) {
        const selectedPage = detail.pages[normalizedPageIndex];
        if (!selectedPage) {
            throw new Error(`pageIndex 超出范围，当前视频共有 ${detail.pages.length} 个分 P`);
        }
        return selectedPage;
    }

    if (!detail.cid) {
        throw new Error("视频详情里没有可用的 cid");
    }

    return {
        index: 0,
        cid: String(detail.cid),
        page: 1,
        part: detail.title,
        duration: null,
        from: "",
        firstFrame: detail.pic,
        raw: null
    };
}

// 对外的高层方法：按名称搜索，选定搜索结果，再从视频详情里提取最终可用于弹幕接口的 oid(cid)。
async function searchVideoAndGetOid(keyword, options = {}) {
    const pick = normalizeNonNegativeInteger(options.pick, 0, "pick");
    const pageIndex = normalizeNonNegativeInteger(options.pageIndex, 0, "pageIndex");
    const searchResult = await searchVideosByKeyword(keyword, options);

    if (searchResult.items.length === 0) {
        throw new Error(`没有搜索到与“${searchResult.keyword}”相关的视频`);
    }

    const picked = searchResult.items[pick];
    if (!picked) {
        throw new Error(`pick 超出范围，当前只搜索到 ${searchResult.items.length} 条结果`);
    }

    if (!picked.bvid) {
        throw new Error("选中的搜索结果里没有 bvid");
    }

    const detail = await getVideoDetailByBvid(picked.bvid, options);
    const selectedPage = resolveSelectedPage(detail, pageIndex);

    return {
        keyword: searchResult.keyword,
        pick,
        pageIndex,
        total: searchResult.total,
        picked,
        oid: selectedPage.cid,
        cid: selectedPage.cid,
        bvid: detail.bvid,
        aid: detail.aid ?? picked.aid,
        title: detail.title || picked.title,
        pageCount: detail.pages.length > 0 ? detail.pages.length : 1,
        selectedPage,
        pages: detail.pages,
        detail
    };
}

async function main() {
    const [, , keywordArg, pickArg, pageIndexArg] = process.argv;
    if (!keywordArg) {
        console.error("用法: node src/platforms/bilibili/video_search.js <关键词> [pick] [pageIndex]");
        process.exitCode = 1;
        return;
    }

    const result = await searchVideoAndGetOid(keywordArg, {
        pick: pickArg,
        pageIndex: pageIndexArg
    });
    console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
    main().catch((error) => {
        console.error("[视频搜索] 执行失败", error);
        process.exitCode = 1;
    });
}

module.exports = {
    getVideoDetailByBvid,
    searchVideoAndGetOid,
    searchVideosByKeyword
};
