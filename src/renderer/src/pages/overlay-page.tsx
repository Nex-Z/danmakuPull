import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  FastForward,
  Gauge,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pause,
  Play,
  Pin,
  PinOff,
  ScanLine,
  Volume2,
  X
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { DanmakuStage } from "@/components/overlay/danmaku-stage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatMs } from "@/lib/format";
import type {
  ContentScale,
  DanmakuItem,
  OverlayBoundsPreset,
  OverlayRuntimeState,
  OverlaySession,
  PlaybackChunk
} from "@shared/types";

const scales: ContentScale[] = [0.75, 1, 1.25, 1.5, 2];
const presets: Array<{ value: OverlayBoundsPreset; label: string }> = [
  { value: "fullscreen", label: "全屏" },
  { value: "top-half", label: "上半屏" },
  { value: "bottom-half", label: "下半屏" },
  { value: "left-half", label: "左半屏" },
  { value: "right-half", label: "右半屏" },
  { value: "custom", label: "自定义" }
];

function mergeItems(base: DanmakuItem[], next: DanmakuItem[]) {
  const map = new Map<string, DanmakuItem>();
  for (const item of base) {
    map.set(`${item.sourceRange.chunkKey}:${item.id}`, item);
  }
  for (const item of next) {
    map.set(`${item.sourceRange.chunkKey}:${item.id}`, item);
  }
  return Array.from(map.values()).sort((left, right) => left.timeMs - right.timeMs);
}

export function OverlayPage() {
  const [params] = useSearchParams();
  const resourceId = Number(params.get("resourceId") || 0);
  const [chunk, setChunk] = useState<PlaybackChunk | null>(null);
  const [runtimeState, setRuntimeState] = useState<OverlayRuntimeState | null>(null);
  const [paused, setPaused] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [rate, setRate] = useState(1);
  const [opacity, setOpacity] = useState(1);
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [showScroll, setShowScroll] = useState(true);
  const [showTop, setShowTop] = useState(true);
  const [showBottom, setShowBottom] = useState(true);
  const hideTimerRef = useRef<number | null>(null);
  const prefetchRef = useRef(0);

  const deferredFilterText = useDeferredValue(filterText);
  const compact = (runtimeState?.bounds?.width ?? window.innerWidth) < 720;

  useEffect(() => {
    if (!resourceId) {
      return;
    }

    let disposed = false;

    void (async () => {
      const [initialChunk, state, session] = await Promise.all([
        window.app.playback.loadInitial(resourceId),
        window.app.overlay.getState(),
        window.app.playback.loadSession(resourceId)
      ]);
      if (disposed) {
        return;
      }
      startTransition(() => {
        setChunk(initialChunk);
        setRuntimeState(state);
        applySession(session);
      });
    })();

    const unsubscribeState = window.app.overlay.onState((state) => {
      setRuntimeState(state);
    });
    const unsubscribeSignal = window.app.overlay.onSignal((signal) => {
      if (signal.type === "show-toolbar") {
        setToolbarVisible(true);
        scheduleToolbarHide();
      } else {
        setToolbarVisible(false);
      }
    });

    return () => {
      disposed = true;
      unsubscribeState();
      unsubscribeSignal();
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, [resourceId]);

  useEffect(() => {
    if (paused) {
      return;
    }
    let frame = 0;
    let previous = performance.now();

    const tick = (now: number) => {
      const delta = now - previous;
      previous = now;
      setPositionMs((current) => current + delta * rate);
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [paused, rate]);

  useEffect(() => {
    if (!chunk) {
      return;
    }
    if (positionMs + 15000 < chunk.stats.cachedUntilMs) {
      return;
    }
    if (prefetchRef.current >= chunk.stats.cachedUntilMs) {
      return;
    }
    prefetchRef.current = chunk.stats.cachedUntilMs;
    void window.app.playback
      .loadRange({
        resourceId,
        startMs: chunk.stats.cachedUntilMs,
        endMs: chunk.stats.cachedUntilMs + 120000
      })
      .then((nextChunk) => {
        setChunk((current) =>
          current
            ? {
                ...nextChunk,
                items: mergeItems(current.items, nextChunk.items),
                stats: nextChunk.stats,
                minTimeMs: Math.min(current.minTimeMs, nextChunk.minTimeMs),
                maxTimeMs: Math.max(current.maxTimeMs, nextChunk.maxTimeMs)
              }
            : nextChunk
        );
      })
      .catch(() => {
        prefetchRef.current = 0;
      });
  }, [chunk, positionMs, resourceId]);

  useEffect(() => {
    if (!chunk || !runtimeState) {
      return;
    }
    const timer = window.setTimeout(() => {
      const session: OverlaySession = {
        resourceId,
        positionMs,
        rate,
        opacity,
        boundsPreset: runtimeState.boundsPreset,
        bounds:
          runtimeState.bounds ?? {
            x: 0,
            y: 0,
            width: window.innerWidth,
            height: window.innerHeight
          },
        contentScale: runtimeState.contentScale,
        displayId: runtimeState.displayId,
        alwaysOnTop: runtimeState.alwaysOnTop,
        updatedAt: new Date().toISOString()
      };
      void window.app.playback.saveSession(session);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [chunk, opacity, positionMs, rate, resourceId, runtimeState]);

  const filteredItems = useMemo(() => {
    if (!chunk) {
      return [];
    }
    const query = deferredFilterText.trim().toLowerCase();
    return chunk.items.filter((item) => {
      const numericMode = Number(item.mode);
      const passMode =
        (numericMode === 5 && showTop) ||
        (numericMode === 4 && showBottom) ||
        (![4, 5].includes(numericMode) && showScroll);
      if (!passMode) {
        return false;
      }
      if (!query) {
        return true;
      }
      return item.content.toLowerCase().includes(query);
    });
  }, [chunk, deferredFilterText, showBottom, showScroll, showTop]);

  function applySession(session: OverlaySession | null) {
    if (!session) {
      return;
    }
    setPositionMs(session.positionMs);
    setRate(session.rate);
    setOpacity(session.opacity);
  }

  function scheduleToolbarHide() {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      setToolbarVisible(false);
      void window.app.overlay.setPassThrough(true);
    }, 2000);
  }

  function bump(deltaMs: number) {
    setPositionMs((current) => Math.max(0, current + deltaMs));
    scheduleToolbarHide();
  }

  async function changePreset(value: OverlayBoundsPreset) {
    await window.app.overlay.setBoundsPreset(value);
    scheduleToolbarHide();
  }

  async function toggleAlwaysOnTop() {
    if (!runtimeState) {
      return;
    }
    await window.app.overlay.setAlwaysOnTop(!runtimeState.alwaysOnTop);
    scheduleToolbarHide();
  }

  async function changeScale(value: ContentScale) {
    await window.app.overlay.setContentScale(value);
    scheduleToolbarHide();
  }

  if (!resourceId || !chunk || !runtimeState) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent text-white">
        正在准备悬浮弹幕窗…
      </div>
    );
  }

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-transparent text-white"
      onMouseMove={() => {
        if (toolbarVisible) {
          scheduleToolbarHide();
        }
      }}
    >
      <div className="absolute inset-0 pointer-events-none">
        <DanmakuStage
          items={filteredItems}
          currentTimeMs={positionMs}
          contentScale={runtimeState.contentScale}
          opacity={opacity}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center px-4 pt-4">
        <div
          className={`pointer-events-auto w-full max-w-6xl transition-all duration-200 ${
            toolbarVisible ? "translate-y-0 opacity-100" : "-translate-y-4 opacity-0"
          }`}
          onMouseEnter={() => {
            setToolbarVisible(true);
            void window.app.overlay.setPassThrough(false);
            scheduleToolbarHide();
          }}
        >
          <Card className="border-white/10 bg-slate-950/78 text-white shadow-2xl backdrop-blur-xl">
            <div className="flex flex-col gap-3 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">
                    {chunk.resource.title}
                  </div>
                  <div className="truncate text-xs text-slate-300">
                    {chunk.resource.subtitle}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {chunk.resource.platform === "bilibili" ? "Bilibili" : "Tencent"}
                  </Badge>
                  <Badge variant="outline" className="border-white/20 text-white">
                    {formatMs(positionMs)}
                  </Badge>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => setPaused((current) => !current)}>
                  {paused ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}
                  {paused ? "开始" : "暂停"}
                </Button>
                <Button variant="outline" onClick={() => setPositionMs(0)}>
                  <ChevronLeft data-icon="inline-start" />
                  回到开头
                </Button>
                <Button variant="outline" onClick={() => bump(-30000)}>
                  <FastForward data-icon="inline-start" />
                  -30s
                </Button>
                <Button variant="outline" onClick={() => bump(-5000)}>
                  <ChevronLeft data-icon="inline-start" />
                  -5s
                </Button>
                <Button variant="outline" onClick={() => bump(5000)}>
                  <ChevronRight data-icon="inline-start" />
                  +5s
                </Button>
                <Button variant="outline" onClick={() => bump(30000)}>
                  <FastForward data-icon="inline-start" />
                  +30s
                </Button>
                <ToggleGroup
                  type="single"
                  value={String(rate)}
                  onValueChange={(value) => {
                    if (value) {
                      setRate(Number(value));
                      scheduleToolbarHide();
                    }
                  }}
                >
                  {["0.5", "1", "1.25", "1.5", "2"].map((item) => (
                    <ToggleGroupItem key={item} value={item}>
                      {item}x
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>

                {compact ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline">
                        <MoreHorizontal data-icon="inline-start" />
                        更多
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuLabel>窗口与显示</DropdownMenuLabel>
                      <DropdownMenuGroup>
                        {presets.map((preset) => (
                          <DropdownMenuCheckboxItem
                            key={preset.value}
                            checked={runtimeState.boundsPreset === preset.value}
                            onCheckedChange={() => void changePreset(preset.value)}
                          >
                            {preset.label}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>内容缩放</DropdownMenuLabel>
                      <DropdownMenuGroup>
                        {scales.map((scale) => (
                          <DropdownMenuCheckboxItem
                            key={scale}
                            checked={runtimeState.contentScale === scale}
                            onCheckedChange={() => void changeScale(scale)}
                          >
                            {Math.round(scale * 100)}%
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <>
                    <ToggleGroup
                      type="single"
                      value={runtimeState.boundsPreset}
                      onValueChange={(value) => {
                        if (value) {
                          void changePreset(value as OverlayBoundsPreset);
                        }
                      }}
                    >
                      {presets.map((preset) => (
                        <ToggleGroupItem key={preset.value} value={preset.value}>
                          {preset.label}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    <ToggleGroup
                      type="single"
                      value={String(runtimeState.contentScale)}
                      onValueChange={(value) => {
                        if (value) {
                          void changeScale(Number(value) as ContentScale);
                        }
                      }}
                    >
                      {scales.map((scale) => (
                        <ToggleGroupItem key={scale} value={String(scale)}>
                          {Math.round(scale * 100)}%
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </>
                )}

                <Button variant="outline" onClick={() => void toggleAlwaysOnTop()}>
                  {runtimeState.alwaysOnTop ? (
                    <Pin data-icon="inline-start" />
                  ) : (
                    <PinOff data-icon="inline-start" />
                  )}
                  {runtimeState.alwaysOnTop ? "取消置顶" : "置顶"}
                </Button>
                <Button variant="outline" onClick={() => void window.app.overlay.close()}>
                  <X data-icon="inline-start" />
                  关闭
                </Button>
              </div>

              <div className="grid items-center gap-3 xl:grid-cols-[1.2fr_1fr_1fr]">
                <div className="flex items-center gap-3">
                  <ScanLine className="size-4 text-slate-400" />
                  <Slider
                    value={[positionMs]}
                    min={0}
                    max={Math.max(chunk.maxTimeMs, positionMs + 1000)}
                    step={100}
                    onValueChange={(value) => {
                      setPositionMs(value[0] ?? 0);
                      scheduleToolbarHide();
                    }}
                  />
                  <span className="min-w-18 text-right text-xs text-slate-300">
                    {formatMs(chunk.maxTimeMs)}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <Volume2 className="size-4 text-slate-400" />
                  <Slider
                    value={[opacity * 100]}
                    min={20}
                    max={100}
                    step={5}
                    onValueChange={(value) => {
                      setOpacity((value[0] ?? 100) / 100);
                      scheduleToolbarHide();
                    }}
                  />
                  <span className="min-w-14 text-right text-xs text-slate-300">
                    {Math.round(opacity * 100)}%
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <Gauge className="size-4 text-slate-400" />
                  <Input
                    value={filterText}
                    onChange={(event) => setFilterText(event.target.value)}
                    placeholder="关键词过滤"
                    className="border-white/10 bg-white/5 text-white placeholder:text-slate-400"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup
                  type="multiple"
                  value={[
                    ...(showScroll ? ["scroll"] : []),
                    ...(showTop ? ["top"] : []),
                    ...(showBottom ? ["bottom"] : [])
                  ]}
                  onValueChange={(value) => {
                    setShowScroll(value.includes("scroll"));
                    setShowTop(value.includes("top"));
                    setShowBottom(value.includes("bottom"));
                    scheduleToolbarHide();
                  }}
                >
                  <ToggleGroupItem value="scroll">滚动</ToggleGroupItem>
                  <ToggleGroupItem value="top">顶部</ToggleGroupItem>
                  <ToggleGroupItem value="bottom">底部</ToggleGroupItem>
                </ToggleGroup>
                <div className="ml-auto flex items-center gap-2 text-xs text-slate-300">
                  <Maximize2 className="size-3.5" />
                  <span>
                    {runtimeState.bounds?.width ?? window.innerWidth} ×{" "}
                    {runtimeState.bounds?.height ?? window.innerHeight}
                  </span>
                  <Minimize2 className="ml-3 size-3.5" />
                  <span>{filteredItems.length} 条可见弹幕</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
