/**
 * Chrome Extension Bridge — Type Definitions
 */

export type ChromeExtBackendResolution =
  | { readonly backend: "extension"; readonly socketPath: string }
  | { readonly backend: "unavailable"; readonly reason: string };

/** Message sent from CLI to native host (via socket). */
export interface ChromeExtRequest {
  readonly id: string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

/** Response received from native host (via socket). */
export interface ChromeExtResponse {
  readonly id: string;
  readonly result?: unknown;
  readonly error?: string;
}

export type ChromiumBrowser =
  | "chrome" | "brave" | "arc" | "chromium" | "edge" | "vivaldi" | "opera";

export interface BrowserConfig {
  readonly name: string;
  readonly macos: {
    readonly appName: string;
    readonly dataPath: readonly string[];
    readonly nativeMessagingPath: readonly string[];
  };
  readonly linux: {
    readonly binaries: readonly string[];
    readonly dataPath: readonly string[];
    readonly nativeMessagingPath: readonly string[];
  };
  readonly windows: {
    readonly dataPath: readonly string[];
    readonly registryKey: string;
    readonly useRoaming?: boolean;
  };
}
