import { contextBridge, ipcRenderer } from "electron";
import type { AppApi } from "@shared/types";

const api: AppApi = {
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    update: (partial) => ipcRenderer.invoke("config:update", partial)
  },
  credentials: {
    get: (platform) => ipcRenderer.invoke("credentials:get", platform),
    set: (platform, payload) =>
      ipcRenderer.invoke("credentials:set", platform, payload),
    test: (platform) => ipcRenderer.invoke("credentials:test", platform)
  },
  search: {
    run: (input) => ipcRenderer.invoke("search:run", input)
  },
  resource: {
    save: (selection) => ipcRenderer.invoke("resource:save", selection),
    list: () => ipcRenderer.invoke("resource:list"),
    delete: (resourceId) => ipcRenderer.invoke("resource:delete", resourceId)
  },
  fetch: {
    start: (input) => ipcRenderer.invoke("fetch:start", input),
    listJobs: () => ipcRenderer.invoke("fetch:list"),
    cancel: (jobId) => ipcRenderer.invoke("fetch:cancel", jobId)
  },
  overlay: {
    open: (input) => ipcRenderer.invoke("overlay:open", input),
    close: () => ipcRenderer.invoke("overlay:close"),
    setBoundsPreset: (preset) =>
      ipcRenderer.invoke("overlay:set-bounds-preset", preset),
    setAlwaysOnTop: (enabled) =>
      ipcRenderer.invoke("overlay:set-always-on-top", enabled),
    setContentScale: (scale) =>
      ipcRenderer.invoke("overlay:set-content-scale", scale),
    setPassThrough: (enabled) =>
      ipcRenderer.invoke("overlay:set-pass-through", enabled),
    getState: () => ipcRenderer.invoke("overlay:get-state"),
    onState: (listener) => {
      const handler = (_event: unknown, payload: unknown) => {
        listener(payload as Awaited<ReturnType<AppApi["overlay"]["getState"]>>);
      };
      ipcRenderer.on("overlay:state", handler);
      return () => ipcRenderer.removeListener("overlay:state", handler);
    },
    onSignal: (listener) => {
      const handler = (_event: unknown, payload: unknown) => {
        listener(payload as { type: "show-toolbar" | "hide-toolbar" });
      };
      ipcRenderer.on("overlay:signal", handler);
      return () => ipcRenderer.removeListener("overlay:signal", handler);
    }
  },
  playback: {
    loadInitial: (resourceId) =>
      ipcRenderer.invoke("playback:load-initial", resourceId),
    loadRange: (input) => ipcRenderer.invoke("playback:load-range", input),
    loadSession: (resourceId) =>
      ipcRenderer.invoke("playback:load-session", resourceId),
    saveSession: (session) =>
      ipcRenderer.invoke("playback:save-session", session)
  }
};

contextBridge.exposeInMainWorld("app", api);
