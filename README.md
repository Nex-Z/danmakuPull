# danmakuPull

当前仓库已经扩展为一个 Electron 桌面客户端项目，目标是把原先的弹幕搜索 / 抓取脚本升级成可直接使用的本地工具：

- 主窗口支持平台配置、搜索管理、资源缓存、抓取任务查看
- 支持选择 `Bilibili / Tencent Video` 搜索目标电影或视频
- 选中资源后可直接打开悬浮弹幕窗，进行播放、暂停、快进、快退、置顶切换和窗口范围调整
- 悬浮弹幕窗支持 `全屏 / 上半屏 / 下半屏 / 左半屏 / 右半屏 / 自定义`，并支持内容缩放和窗口尺寸缩放

同时，仓库仍然保留了原先的 Node 调试脚本，便于单独验证平台搜索和弹幕抓取链路。

平台相关代码统一收敛到 `src/platforms/`，根目录只保留项目级配置、缓存和说明文档，方便后续继续扩展更多平台。

## 桌面客户端

### 技术栈

- Electron
- React + TypeScript + Vite
- shadcn/ui + Tailwind CSS
- PixiJS
- SQLite（通过 Node 内置 `node:sqlite`）

### 当前页面

- `搜索管理`：选择平台、按名称搜索、保存资源、直接播放弹幕
- `资源缓存`：查看已保存资源、缓存块数量、弹幕数量、继续预抓、直接播放
- `抓取任务`：查看最近任务与取消运行中任务
- `平台设置`：配置 Cookie、User-Agent、Referer、缓存目录和默认行为

### 悬浮弹幕窗

- 独立 `Overlay BrowserWindow`
- 默认置顶，可随时取消
- 支持 hover 显示工具条
- 支持开始 / 暂停 / 回到开头 / `±5s` / `±30s` / 倍速 / 透明度 / 关键词过滤
- 支持窗口范围预设与内容缩放
- 非工具条区域默认点击穿透，避免长期遮挡底层播放器

### 开发运行

```powershell
npm install
npm run dev
```

### 构建

```powershell
npm run build
npm test
```

如需产出 Windows 安装包：

```powershell
npm run dist
```

### 配置与存储

- 桌面客户端运行时设置保存在 Electron `userData` 目录
- 客户端默认缓存目录位于 `userData/cache`
- 平台凭证通过 Electron `safeStorage` 加密后落库
- `.env.local` 现在主要用于 CLI 调试兼容，不再是桌面客户端正式配置来源

## CLI 能力

当前仓库主要用于调试和验证视频弹幕相关能力，现阶段包含这些可直接运行的能力：

- 按视频标题搜索视频，并拿到弹幕接口需要的 `cid/oid`
- 按 `oid + pid` 拉取弹幕分段，缓存原始 `seg.so` 和解析后的 JSON
- 按 `vid + 时间窗口` 拉取腾讯视频弹幕分段，并缓存原始响应和解析结果

## 目录说明

```text
.
├─ src/
│  ├─ platforms/
│  │  ├─ bilibili/
│  │  │  ├─ danmaku.js       # 弹幕分段请求与 seg.so 解析
│  │  │  ├─ index.js         # 弹幕拉取测试入口
│  │  │  └─ video_search.js  # 按视频标题搜索并解析 cid/oid
│  │  ├─ shared/
│  │  │  └─ env.js           # .env / .env.local 加载
│  │  └─ tencent/
│  │     ├─ danmaku.js       # 腾讯视频弹幕时间窗口请求与解析
│  │     ├─ index.js         # 腾讯弹幕拉取测试入口
│  │     └─ video_search.js  # 按视频标题搜索并解析腾讯视频 vid
├─ .env.example        # 环境变量模板
└─ README.md
```

## 环境要求

- Node.js 18 及以上
- 能访问目标平台的 Web 接口
- 如果要抓 Bilibili 弹幕，本地 `.env.local` 中需要提供有效的 `BILI_COOKIE`

## CLI 快速开始

1. 安装 Node.js
2. 复制环境变量模板
3. 填写本地调试所需的 Cookie
4. 运行搜索或弹幕抓取脚本

```powershell
Copy-Item .env.example .env.local
```

如果要运行 Bilibili 相关能力，`.env.local` 至少需要填写：

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
node .\src\platforms\bilibili\video_search.js "视频标题"
```

也可以指定：

- `pick`：选择搜索结果中的第几个视频，从 `0` 开始
- `pageIndex`：多 P 视频选第几 P，从 `0` 开始

```powershell
node .\src\platforms\bilibili\video_search.js "视频标题" 0 1
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
node .\src\platforms\bilibili\index.js
npm run bili:start
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
$env:BILI_RUN_SEGMENTS='3'; node .\src\platforms\bilibili\index.js
$env:BILI_RUN_SEGMENTS='all'; node .\src\platforms\bilibili\index.js
$env:BILI_EXPORT_PATH='cache\bilibili\export.json'; node .\src\platforms\bilibili\index.js
```

说明：

- `BILI_RUN_SEGMENTS=all|auto|until-empty` 会持续抓取，直到连续空段达到阈值
- `BILI_PRINT_LIMIT=0` 表示控制台打印当前段全部弹幕
- `BILI_EXPORT_PATH` 会导出当前运行中抓到的全部弹幕 JSON

## 腾讯视频弹幕抓取

腾讯视频弹幕接口按时间窗口切片，请求路径形如：

```text
/barrage/segment/{vid}/t/v1/{startMs}/{endMs}
```

例如：

```text
https://dm.video.qq.com/barrage/segment/p0046u5fcwo/t/v1/5910000/5940000
```

表示抓取视频 `p0046u5fcwo` 在 `98:30 ~ 99:00` 这 30 秒内的弹幕。

运行方式：

```powershell
node .\src\platforms\tencent\index.js
npm run tx:start
```

常用环境变量：

```env
TX_VID=p0046u5fcwo
TX_START_MS=5910000
TX_WINDOW_MS=30000
TX_RUN_WINDOWS=1
TX_REQUEST_INTERVAL_MS=2000
TX_RANDOM_JITTER_MS=0
TX_PRINT_LIMIT=20
TX_REFERER=https://v.qq.com/
TX_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0
```

示例：

```powershell
$env:TX_RUN_WINDOWS='3'; node .\src\platforms\tencent\index.js
$env:TX_START_MS='0'; $env:TX_WINDOW_MS='30000'; npm run tx:start
$env:TX_EXPORT_PATH='cache\tencent\export.json'; node .\src\platforms\tencent\index.js
```

说明：

- `TX_START_MS` 和 `TX_WINDOW_MS` 的单位都是毫秒
- `TX_RUN_WINDOWS` 表示从起始时间开始连续抓几个时间窗口
- `TX_PRINT_LIMIT=0` 表示控制台不打印预览；大于 `0` 时打印当前窗口前 N 条
- `TX_EXPORT_PATH` 会导出当前运行抓到的全部弹幕 JSON

## 腾讯视频搜索

腾讯视频当前已补充按标题搜索 `vid` 的能力，搜索接口使用的是：

```text
POST https://pbaccess.video.qq.com/trpc.videosearch.mobile_search.MultiTerminalSearch/MbSearch?vversion_platform=2
```

运行方式：

```powershell
node .\src\platforms\tencent\video_search.js "视频标题"
npm run tx:search -- "视频标题"
```

也可以指定：

- `pick`：选择搜索结果中的第几个视频，从 `0` 开始

```powershell
node .\src\platforms\tencent\video_search.js "速度与激情10" 0
npm run tx:search -- "庆余年" 1
```

返回结果中最关键的字段是：

- `vid`
- `title`
- `picked`

当前实现里，弹幕接口所需的 `vid` 直接取自搜索结果项的 `doc.id`。

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

腾讯视频弹幕则会写入：

```text
cache/tencent/{vid}/
├─ segment_0059100000_0059400000.source.json
└─ segment_0059100000_0059400000.parsed.json
```

含义如下：

- `.source.json`：接口原始 JSON 响应
- `.parsed.json`：补充时间窗口元信息后的归一化弹幕列表

## 代码调用示例

按标题搜索 `oid`：

```js
const { searchVideoAndGetOid } = require("./src/platforms/bilibili/video_search");

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
const { createDanmakuPump } = require("./src/platforms/bilibili/danmaku");

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

直接抓腾讯视频弹幕：

```js
const { fetchBarrageSegment } = require("./src/platforms/tencent/danmaku");

async function main() {
  const result = await fetchBarrageSegment({
    vid: "p0046u5fcwo",
    startMs: 5910000,
    endMs: 5940000,
    previewLimit: 5
  });

  console.log(result.barrages.length);
}

main();
```

按标题搜索腾讯视频 `vid`：

```js
const { searchVideoAndGetVid } = require("./src/platforms/tencent/video_search");

async function main() {
  const result = await searchVideoAndGetVid("速度与激情10", {
    pick: 0
  });

  console.log(result.vid);
}

main();
```

## 当前限制

- 当前只覆盖普通视频搜索与详情链路
- 番剧、影视、课程等 PGC 内容通常不适用这条 `search -> view -> cid` 路径
- 多平台聚合能力暂未实现，当前仓库仍以 Bilibili 调试为主
- 腾讯视频当前已支持按标题搜索 `vid`，但还没有补腾讯平台的视频详情接口或分集页展开逻辑
