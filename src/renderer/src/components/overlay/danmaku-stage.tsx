import { useEffect, useMemo, useRef } from "react";
import { Application, Container, Text, TextStyle } from "pixi.js";
import type { DanmakuItem } from "@shared/types";

type SpriteState = {
  sprite: Text;
  type: "scroll" | "top" | "bottom";
  durationMs: number;
  velocity: number;
  bornAt: number;
};

type Props = {
  items: DanmakuItem[];
  currentTimeMs: number;
  contentScale: number;
  opacity: number;
};

type TrackInfo = {
  nextFreeMs: number;
};

function detectMode(mode: DanmakuItem["mode"]) {
  const numeric = Number(mode);
  if (numeric === 5) {
    return "top";
  }
  if (numeric === 4) {
    return "bottom";
  }
  return "scroll";
}

function binarySearch(items: DanmakuItem[], targetTime: number) {
  let low = 0;
  let high = items.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (items[middle].timeMs < targetTime) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

export function DanmakuStage({
  items,
  currentTimeMs,
  contentScale,
  opacity
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const containerRef = useRef<Container | null>(null);
  const spritesRef = useRef<Map<string, SpriteState>>(new Map());
  const spawnCursorRef = useRef(0);
  const lastTimeRef = useRef(0);
  const currentTimeRef = useRef(0);
  const viewportRef = useRef({ width: 800, height: 360, pixelRatio: 1 });
  const trackStateRef = useRef<TrackInfo[]>([]);
  const topTrackRef = useRef(0);
  const bottomTrackRef = useRef(0);

  const style = useMemo(
    () =>
      new TextStyle({
        fontFamily: "\"Microsoft YaHei UI\", \"Segoe UI\", sans-serif",
        fontSize: Math.max(18, Math.round(24 * contentScale)),
        fill: "#ffffff",
        stroke: {
          color: "#050816",
          width: Math.max(2, Math.round(3 * contentScale)),
          join: "round"
        },
        dropShadow: {
          alpha: 0.32,
          angle: Math.PI / 2,
          blur: 2,
          color: "#020617",
          distance: 2
        }
      }),
    [contentScale]
  );

  useEffect(() => {
    currentTimeRef.current = currentTimeMs;
  }, [currentTimeMs]);

  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const application = new Application();

    void (async () => {
      await application.init({
        width: host.clientWidth || 800,
        height: host.clientHeight || 360,
        backgroundAlpha: 0,
        antialias: true,
        resizeTo: host
      });
      if (disposed) {
        application.destroy(true, { children: true });
        return;
      }
      host.appendChild(application.canvas);
      containerRef.current = new Container();
      application.stage.addChild(containerRef.current);
      application.stage.alpha = opacity;
      appRef.current = application;

      resizeObserver = new ResizeObserver(() => {
        const pixelRatio = window.devicePixelRatio || 1;
        viewportRef.current = {
          width: host.clientWidth || 800,
          height: host.clientHeight || 360,
          pixelRatio
        };
        resetScene(items, currentTimeRef.current);
      });
      resizeObserver.observe(host);

      application.ticker.add((ticker) => {
        if (!containerRef.current) {
          return;
        }

        containerRef.current.alpha = opacity;
        const currentTime = currentTimeRef.current;
        if (currentTime < lastTimeRef.current - 500) {
          resetScene(items, currentTime);
        }

        while (
          spawnCursorRef.current < items.length &&
          items[spawnCursorRef.current].timeMs <= currentTime
        ) {
          spawnItem(items[spawnCursorRef.current], currentTime);
          spawnCursorRef.current += 1;
        }

        for (const [key, state] of spritesRef.current.entries()) {
          if (state.type === "scroll") {
            state.sprite.x -= state.velocity * ticker.deltaMS;
            if (state.sprite.x + state.sprite.width < -20) {
              containerRef.current.removeChild(state.sprite);
              state.sprite.destroy();
              spritesRef.current.delete(key);
            }
            continue;
          }

          if (currentTime - state.bornAt >= state.durationMs) {
            containerRef.current.removeChild(state.sprite);
            state.sprite.destroy();
            spritesRef.current.delete(key);
          }
        }

        lastTimeRef.current = currentTime;
      });
    })();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      spritesRef.current.forEach((state) => state.sprite.destroy());
      spritesRef.current.clear();
      appRef.current?.destroy(true, { children: true });
      appRef.current = null;
      containerRef.current = null;
    };
  }, [items, opacity]);

  useEffect(() => {
    resetScene(items, currentTimeMs);
  }, [items, contentScale, style, currentTimeMs]);

  function resetScene(nextItems: DanmakuItem[], timeMs: number) {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    container.removeChildren().forEach((child) => child.destroy());
    spritesRef.current.clear();
    spawnCursorRef.current = binarySearch(nextItems, Math.max(0, timeMs - 200));
    lastTimeRef.current = timeMs;
    topTrackRef.current = 0;
    bottomTrackRef.current = 0;
    trackStateRef.current = new Array(
      Math.max(
        1,
        Math.floor(
          Math.max(1, viewportRef.current.height - 24) /
            Math.max(26, Math.round(34 * contentScale))
        )
      )
    )
      .fill(null)
      .map(() => ({ nextFreeMs: 0 }));
  }

  function spawnItem(item: DanmakuItem, currentTime: number) {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const viewport = viewportRef.current;
    const mode = detectMode(item.mode);
    const text = new Text({
      text: item.content,
      style: style.clone()
    });
    text.style.fill = item.color || "#ffffff";
    text.style.fontSize = Math.max(18, Math.round(item.fontSize * contentScale));

    if (mode === "scroll") {
      const trackHeight = Math.max(28, Math.round(36 * contentScale));
      const tracks = trackStateRef.current;
      let trackIndex = 0;
      let bestFree = Number.POSITIVE_INFINITY;

      tracks.forEach((track, index) => {
        if (track.nextFreeMs < bestFree) {
          bestFree = track.nextFreeMs;
          trackIndex = index;
        }
      });

      text.x = viewport.width + 12;
      text.y = 12 + trackIndex * trackHeight;
      const durationMs = 8500;
      const velocity =
        (viewport.width + text.width + 48) / durationMs;
      tracks[trackIndex].nextFreeMs =
        currentTime + ((text.width + 60) / velocity);
      container.addChild(text);
      spritesRef.current.set(`${item.id}:${item.sourceRange.chunkKey}`, {
        sprite: text,
        type: "scroll",
        durationMs,
        velocity,
        bornAt: currentTime
      });
      return;
    }

    const durationMs = 4000;
    text.anchor.set(0.5, 0);
    text.x = viewport.width / 2;
    if (mode === "top") {
      text.y = 12 + topTrackRef.current * Math.max(28, Math.round(34 * contentScale));
      topTrackRef.current = (topTrackRef.current + 1) % Math.max(1, Math.floor(viewport.height / 5));
    } else {
      text.y =
        viewport.height -
        42 -
        bottomTrackRef.current * Math.max(28, Math.round(34 * contentScale));
      bottomTrackRef.current =
        (bottomTrackRef.current + 1) % Math.max(1, Math.floor(viewport.height / 5));
    }

    container.addChild(text);
    spritesRef.current.set(`${item.id}:${item.sourceRange.chunkKey}`, {
      sprite: text,
      type: mode,
      durationMs,
      velocity: 0,
      bornAt: currentTime
    });
  }

  return <div ref={hostRef} className="size-full" />;
}
