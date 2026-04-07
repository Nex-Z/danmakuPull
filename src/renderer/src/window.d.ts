import type { AppApi } from "@shared/types";

declare global {
  interface Window {
    app: AppApi;
  }
}

export {};
