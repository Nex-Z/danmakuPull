# danmakuPull

当前仓库主要用于调试和验证 Bilibili 弹幕相关能力，现阶段包含两条可直接运行的能力：

- 按视频标题搜索视频，并拿到弹幕接口需要的 `cid/oid`
- 按 `oid + pid` 拉取弹幕分段，缓存原始 `seg.so` 和解析后的 JSON

## 目录说明

```text
.
├─ bilibili/
│  ├─ danmaku.js       # 弹幕分段请求与 seg.so 解析
│  ├─ env.js           # .env / .env.local 加载
│  ├─ index.js         # 弹幕拉取测试入口
│  └─ video_search.js  # 按视频标题搜索并解析 cid/oid
├─ .env.example        # 环境变量模板
└─ README.md
```

## 环境要求

- Node.js 18 及以上
- 能访问 Bilibili Web 接口
- 本地 `.env.local` 中提供有效的 `BILI_COOKIE`

## 快速开始

1. 安装 Node.js
2. 复制环境变量模板
3. 填写本地调试所需的 Cookie
4. 运行搜索或弹幕抓取脚本

```powershell
Copy-Item .env.example .env.local
```

`.env.local` 至少需要填写：

```env
BILI_COOKIE=你的真实 Cookie
BILI_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0
```

`.env.local` 已被 `.gitignore` 忽略，不会进入仓库。提交前仍建议手动检查一次：

```powershell
git diff --cached | Select-String -Pattern 'SESSDATA=|bili_jct=|DedeUserID=|BILI_COOKIE'
```

## 视频搜索

按标题搜索视频，并拿到后续弹幕接口所需的 `oid`：

```powershell
node .\bilibili\video_search.js "视频标题"
```

也可以指定：

- `pick`：选择搜索结果中的第几个视频，从 `0` 开始
- `pageIndex`：多 P 视频选第几 P，从 `0` 开始

```powershell
node .\bilibili\video_search.js "视频标题" 0 1
npm run bili:search -- "视频标题" 0 1
```

脚本内部采用两步链路：

1. `/x/web-interface/search/type` 搜索候选视频
2. `/x/web-interface/view?bvid=...` 获取详情并提取 `cid/pages[].cid`

返回结果中最关键的字段是：

- `oid`
- `cid`
- `bvid`
- `picked`
- `selectedPage`
- `pages`

## 弹幕抓取

准备好 `oid` 和 `pid` 后，可以直接抓取弹幕分段：

```powershell
node .\bilibili\index.js
npm start
```

常用环境变量：

```env
BILI_OID=37158258607
BILI_PID=116315968898577
BILI_RUN_SEGMENTS=1
BILI_START_SEGMENT=1
BILI_REQUEST_INTERVAL_MS=2000
BILI_MAX_EMPTY_SEGMENTS=2
BILI_RANDOM_JITTER_MS=0
BILI_PRINT_LIMIT=20
BILI_REFERER=https://www.bilibili.com
```

示例：

```powershell
$env:BILI_RUN_SEGMENTS='3'; node .\bilibili\index.js
$env:BILI_RUN_SEGMENTS='all'; node .\bilibili\index.js
$env:BILI_EXPORT_PATH='cache\bilibili\export.json'; node .\bilibili\index.js
```

说明：

- `BILI_RUN_SEGMENTS=all|auto|until-empty` 会持续抓取，直到连续空段达到阈值
- `BILI_PRINT_LIMIT=0` 表示控制台打印当前段全部弹幕
- `BILI_EXPORT_PATH` 会导出当前运行中抓到的全部弹幕 JSON

## 缓存输出

每个成功抓到的弹幕分段都会写入：

```text
cache/bilibili/{oid}/
├─ segment_000001.seg.so
└─ segment_000001.parsed.json
```

含义如下：

- `.seg.so`：接口原始二进制响应，便于离线复现或重新解析
- `.parsed.json`：解析后的 UTF-8 JSON，便于直接消费和调试

## 代码调用示例

按标题搜索 `oid`：

```js
const { searchVideoAndGetOid } = require("./bilibili/video_search");

async function main() {
  const result = await searchVideoAndGetOid("视频标题", {
    pick: 0,
    pageIndex: 0
  });

  console.log(result.oid);
}

main();
```

直接抓弹幕：

```js
const { createDanmakuPump } = require("./bilibili/danmaku");

async function main() {
  const pump = createDanmakuPump({
    oid: "37158258607",
    pid: "116315968898577",
    previewLimit: 5
  });

  const results = await pump.runSegments(1);
  console.log(results[0]?.elems?.length ?? 0);
}

main();
```

## 当前限制

- 当前只覆盖普通视频搜索与详情链路
- 番剧、影视、课程等 PGC 内容通常不适用这条 `search -> view -> cid` 路径
- 多平台聚合能力暂未实现，当前仓库仍以 Bilibili 调试为主
