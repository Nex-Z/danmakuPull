import { app, BrowserWindow, ipcMain } from "electron";
import { DesktopAppService } from "./services/app-service";
import { OverlayController } from "./windows/overlay-controller";
import { loadRendererRoute, preloadPath } from "./windows/window-helpers";

const appService = new DesktopAppService();
const overlayController = new OverlayController(appService);
let mainWindow: BrowserWindow | null = null;

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1160,
    minHeight: 760,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#eef2ff",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  void loadRendererRoute(window, "/");

  return window;
}

function registerIpc() {
  ipcMain.handle("config:get", () => appService.getSettings());
  ipcMain.handle("config:update", (_, partial) => appService.updateSettings(partial));

  ipcMain.handle("credentials:get", (_, platform) =>
    appService.getCredentials(platform)
  );
  ipcMain.handle("credentials:set", (_, platform, payload) =>
    appService.setCredentials(platform, payload)
  );
  ipcMain.handle("credentials:test", (_, platform) =>
    appService.testCredentials(platform)
  );

  ipcMain.handle("search:run", (_, input) => appService.search(input));

  ipcMain.handle("resource:save", (_, selection) =>
    appService.saveResource(selection)
  );
  ipcMain.handle("resource:list", () => appService.listResources());
  ipcMain.handle("resource:delete", (_, resourceId) =>
    appService.deleteResource(resourceId)
  );

  ipcMain.handle("fetch:start", (_, input) => appService.startFetch(input));
  ipcMain.handle("fetch:list", () => appService.listFetchJobs());
  ipcMain.handle("fetch:cancel", (_, jobId) => appService.cancelFetch(jobId));

  ipcMain.handle("overlay:open", (_, input) => overlayController.open(input));
  ipcMain.handle("overlay:close", () => overlayController.close());
  ipcMain.handle("overlay:set-bounds-preset", (_, preset) =>
    overlayController.setBoundsPreset(preset)
  );
  ipcMain.handle("overlay:set-always-on-top", (_, enabled) =>
    overlayController.setAlwaysOnTop(enabled)
  );
  ipcMain.handle("overlay:set-content-scale", (_, scale) =>
    overlayController.setContentScale(scale)
  );
  ipcMain.handle("overlay:set-pass-through", (_, enabled) =>
    overlayController.setPassThrough(enabled)
  );
  ipcMain.handle("overlay:get-state", () => overlayController.getState());

  ipcMain.handle("playback:load-initial", (_, resourceId) =>
    appService.loadInitial(resourceId)
  );
  ipcMain.handle("playback:load-range", (_, input) =>
    appService.loadRange(input)
  );
  ipcMain.handle("playback:load-session", (_, resourceId) =>
    appService.loadSession(resourceId)
  );
  ipcMain.handle("playback:save-session", (_, session) =>
    appService.saveSession(session)
  );
}

app.whenReady().then(async () => {
  await appService.initialize();
  registerIpc();
  mainWindow = createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
