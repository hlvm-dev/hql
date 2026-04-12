/**
 * Chrome Extension Bridge — Type Definitions
 */

// ── Backend Resolution ──────────────────────────────────────────────

export type ChromeExtBackendResolution =
  | {
      readonly backend: "extension";
      readonly socketPath: string;
    }
  | {
      readonly backend: "unavailable";
      readonly reason: string;
    };

// ── Native Messaging Protocol Types ─────────────────────────────────

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

// ── Tool Methods ────────────────────────────────────────────────────

export type ChromeExtMethod =
  // Navigation
  | "navigate"
  | "back"
  // Interaction
  | "click"
  | "fill"
  | "type"
  | "hover"
  | "scroll"
  | "select_option"
  // Content
  | "evaluate"
  | "screenshot"
  | "snapshot"
  | "content"
  | "links"
  | "wait_for"
  // Tabs
  | "tabs"
  | "tab_create"
  | "tab_close"
  | "tab_select"
  // Monitoring
  | "get_console_messages"
  | "get_network_requests"
  | "enable_monitoring"
  // System
  | "ping"
  | "get_status";

// ── Tab Info ────────────────────────────────────────────────────────

export interface ChromeTabInfo {
  readonly id: number;
  readonly url: string;
  readonly title: string;
  readonly active: boolean;
  readonly windowId: number;
}

// ── Session State ───────────────────────────────────────────────────

export interface ChromeExtSessionState {
  activeTabId?: number;
  attachedDebuggerTabs: Set<number>;
  monitoringEnabled: boolean;
}

// ── Browser Config (copied from CC's common.ts) ─────────────────────

export type ChromiumBrowser =
  | "chrome"
  | "brave"
  | "arc"
  | "chromium"
  | "edge"
  | "vivaldi"
  | "opera";

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
