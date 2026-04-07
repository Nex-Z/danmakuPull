import { BrowserWindow, screen } from "electron";
import {
  HOTSPOT_HEIGHT,
  MIN_OVERLAY_HEIGHT,
  MIN_OVERLAY_WIDTH
} from "@shared/constants";
import {
  clampBoundsToWorkArea,
  computePresetBounds
} from "@shared/overlay";
import type {
  ContentScale,
  OverlayBoundsPreset,
  OverlayOpenRequest,
  OverlayRuntimeState,
  WindowBounds
} from "@shared/types";
import type { DesktopAppService } from "../services/app-service";
import { loadRendererRoute, preloadPath } from "./window-helpers";

export class OverlayController {
  private window: BrowserWindow | null = null;

  private passThrough = true;

  private monitor: NodeJS.Timeout | null = null;

  private suppressBoundsEvent = false;

  private state: OverlayRuntimeState = {
    resourceId: null,
    boundsPreset: "bottom-half",
    contentScale: 1,
    alwaysOnTop: true,
    bounds: null,
    displayId: null
  };

  constructor(private readonly appService: DesktopAppService) {}

  async open(input: OverlayOpenRequest) {
    await this.appService.ensureInitialPlayback(input.resourceId);
    const settings = this.appService.getSettings();
    const session = this.appService.loadSession(input.resourceId);
    const display =
      (input.displayId &&
        screen.getAllDisplays().find((item) => item.id === input.displayId)) ||
      (session?.displayId &&
        screen.getAllDisplays().find((item) => item.id === session.displayId)) ||
      screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const boundsPreset =
      input.boundsPreset ?? session?.boundsPreset ?? settings.overlay.boundsPreset;
    const contentScale =
      input.contentScale ?? session?.contentScale ?? settings.overlay.contentScale;
    const alwaysOnTop =
      session?.alwaysOnTop ?? settings.overlay.alwaysOnTop;
    const fallbackBounds = clampBoundsToWorkArea(
      computePresetBounds(display.workArea, boundsPreset),
      display.workArea
    );
    const bounds =
      session?.bounds && boundsPreset === "custom"
        ? clampBoundsToWorkArea(session.bounds, display.workArea)
        : fallbackBounds;

    this.state = {
      resourceId: input.resourceId,
      boundsPreset,
      contentScale,
      alwaysOnTop,
      bounds,
      displayId: display.id
    };

    const window = this.ensureWindow();
    this.applyBounds(bounds);
    window.setAlwaysOnTop(alwaysOnTop, "screen-saver");
    await loadRendererRoute(window, `overlay?resourceId=${input.resourceId}`);
    window.showInactive();
    this.setPassThrough(true);
    this.emitState();
    this.ensureHotspotMonitor();
  }

  async close() {
    if (this.window) {
      this.window.hide();
    }
    this.state = {
      ...this.state,
      resourceId: null
    };
  }

  async setBoundsPreset(preset: OverlayBoundsPreset) {
    if (!this.window) {
      return;
    }
    const display = this.resolveDisplay();
    const nextBounds = clampBoundsToWorkArea(
      computePresetBounds(display.workArea, preset),
      display.workArea
    );
    this.state = {
      ...this.state,
      boundsPreset: preset,
      displayId: display.id,
      bounds: nextBounds
    };
    this.applyBounds(nextBounds);
    this.emitState();
  }

  async setAlwaysOnTop(enabled: boolean) {
    this.state = {
      ...this.state,
      alwaysOnTop: enabled
    };
    this.window?.setAlwaysOnTop(enabled, "screen-saver");
    this.emitState();
  }

  async setContentScale(scale: ContentScale) {
    this.state = {
      ...this.state,
      contentScale: scale
    };
    this.emitState();
  }

  async setPassThrough(enabled: boolean) {
    this.passThrough = enabled;
    this.window?.setIgnoreMouseEvents(enabled, {
      forward: enabled
    });
    this.window?.webContents.send("overlay:signal", {
      type: enabled ? "hide-toolbar" : "show-toolbar"
    });
  }

  getState() {
    return this.state;
  }

  emitState() {
    this.window?.webContents.send("overlay:state", this.state);
  }

  private ensureWindow() {
    if (this.window && !this.window.isDestroyed()) {
      return this.window;
    }

    const window = new BrowserWindow({
      width: 960,
      height: 360,
      minWidth: MIN_OVERLAY_WIDTH,
      minHeight: MIN_OVERLAY_HEIGHT,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: true,
      movable: true,
      show: false,
      alwaysOnTop: true,
      fullscreenable: false,
      autoHideMenuBar: true,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: preloadPath
      }
    });

    window.on("closed", () => {
      this.window = null;
      if (this.monitor) {
        clearInterval(this.monitor);
        this.monitor = null;
      }
    });

    window.on("resize", () => {
      this.handleManualBoundsChange();
    });
    window.on("move", () => {
      this.handleManualBoundsChange();
    });

    this.window = window;
    return window;
  }

  private handleManualBoundsChange() {
    if (!this.window || this.suppressBoundsEvent || this.state.resourceId === null) {
      return;
    }
    const bounds = this.window.getBounds();
    this.state = {
      ...this.state,
      boundsPreset: "custom",
      bounds,
      displayId: this.resolveDisplay().id
    };
    this.emitState();
  }

  private resolveDisplay() {
    if (this.window && !this.window.isDestroyed()) {
      return screen.getDisplayMatching(this.window.getBounds());
    }
    if (this.state.displayId) {
      const display = screen
        .getAllDisplays()
        .find((item) => item.id === this.state.displayId);
      if (display) {
        return display;
      }
    }
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }

  private applyBounds(bounds: WindowBounds) {
    if (!this.window) {
      return;
    }
    this.suppressBoundsEvent = true;
    this.window.setBounds(bounds, true);
    this.suppressBoundsEvent = false;
  }

  private ensureHotspotMonitor() {
    if (this.monitor) {
      return;
    }
    this.monitor = setInterval(() => {
      if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) {
        return;
      }
      if (!this.passThrough) {
        return;
      }

      const pointer = screen.getCursorScreenPoint();
      const bounds = this.window.getBounds();
      const inHotspot =
        pointer.x >= bounds.x &&
        pointer.x <= bounds.x + bounds.width &&
        pointer.y >= bounds.y &&
        pointer.y <= bounds.y + HOTSPOT_HEIGHT;

      if (inHotspot) {
        void this.setPassThrough(false);
      }
    }, 150);
  }
}
