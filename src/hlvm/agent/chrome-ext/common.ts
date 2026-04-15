/**
 * Chrome Extension Bridge — Common Paths & Browser Config
 *
 * Copied from Claude Code's utils/claudeInChrome/common.ts with adaptations:
 * - CC uses Node.js os.homedir/platform → HLVM uses getPlatform()
 * - Socket paths use ~/.hlvm/ prefix instead of /tmp/
 * - Native host identifier: com.hlvm.chrome_bridge
 */

import { getPlatform } from "../../../platform/platform.ts";
import type { BrowserConfig, ChromiumBrowser } from "./types.ts";

// ── Constants (SSOT for all chrome-ext config) ──────────────────────
//
// native-host.ts mirrors these values but can't import them (standalone binary).
// If you change these, update native-host.ts to match.

export const NATIVE_HOST_IDENTIFIER = "com.hlvm.chrome_bridge";
export const NATIVE_HOST_MANIFEST_NAME = `${NATIVE_HOST_IDENTIFIER}.json`;
export const CHROME_BRIDGE_DIR_NAME = "chrome-bridge";
export const CHROME_BRIDGE_WRAPPER_NAME = "chrome-bridge-host.sh";
export const MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB — Chrome NM protocol limit

// TODO: Replace with actual extension ID after Chrome Web Store publish
export const EXTENSION_IDS = {
  prod: "PLACEHOLDER_PROD_EXTENSION_ID",
} as const;

// ── Browser Configurations (copied 1:1 from CC) ─────────────────────

export const CHROMIUM_BROWSERS: Record<ChromiumBrowser, BrowserConfig> = {
  chrome: {
    name: "Google Chrome",
    macos: {
      appName: "Google Chrome",
      dataPath: ["Library", "Application Support", "Google", "Chrome"],
      nativeMessagingPath: [
        "Library",
        "Application Support",
        "Google",
        "Chrome",
        "NativeMessagingHosts",
      ],
    },
    linux: {
      binaries: ["google-chrome", "google-chrome-stable"],
      dataPath: [".config", "google-chrome"],
      nativeMessagingPath: [".config", "google-chrome", "NativeMessagingHosts"],
    },
    windows: {
      dataPath: ["Google", "Chrome", "User Data"],
      registryKey: "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts",
    },
  },
  brave: {
    name: "Brave",
    macos: {
      appName: "Brave Browser",
      dataPath: [
        "Library",
        "Application Support",
        "BraveSoftware",
        "Brave-Browser",
      ],
      nativeMessagingPath: [
        "Library",
        "Application Support",
        "BraveSoftware",
        "Brave-Browser",
        "NativeMessagingHosts",
      ],
    },
    linux: {
      binaries: ["brave-browser", "brave"],
      dataPath: [".config", "BraveSoftware", "Brave-Browser"],
      nativeMessagingPath: [
        ".config",
        "BraveSoftware",
        "Brave-Browser",
        "NativeMessagingHosts",
      ],
    },
    windows: {
      dataPath: ["BraveSoftware", "Brave-Browser", "User Data"],
      registryKey:
        "HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts",
    },
  },
  arc: {
    name: "Arc",
    macos: {
      appName: "Arc",
      dataPath: ["Library", "Application Support", "Arc", "User Data"],
      nativeMessagingPath: [
        "Library",
        "Application Support",
        "Arc",
        "User Data",
        "NativeMessagingHosts",
      ],
    },
    linux: {
      binaries: [],
      dataPath: [],
      nativeMessagingPath: [],
    },
    windows: {
      dataPath: ["Arc", "User Data"],
      registryKey: "HKCU\\Software\\ArcBrowser\\Arc\\NativeMessagingHosts",
    },
  },
  chromium: {
    name: "Chromium",
    macos: {
      appName: "Chromium",
      dataPath: ["Library", "Application Support", "Chromium"],
      nativeMessagingPath: [
        "Library",
        "Application Support",
        "Chromium",
        "NativeMessagingHosts",
      ],
    },
    linux: {
      binaries: ["chromium", "chromium-browser"],
      dataPath: [".config", "chromium"],
      nativeMessagingPath: [".config", "chromium", "NativeMessagingHosts"],
    },
    windows: {
      dataPath: ["Chromium", "User Data"],
      registryKey: "HKCU\\Software\\Chromium\\NativeMessagingHosts",
    },
  },
  edge: {
    name: "Microsoft Edge",
    macos: {
      appName: "Microsoft Edge",
      dataPath: ["Library", "Application Support", "Microsoft Edge"],
      nativeMessagingPath: [
        "Library",
        "Application Support",
        "Microsoft Edge",
        "NativeMessagingHosts",
      ],
    },
    linux: {
      binaries: ["microsoft-edge", "microsoft-edge-stable"],
      dataPath: [".config", "microsoft-edge"],
      nativeMessagingPath: [
        ".config",
        "microsoft-edge",
        "NativeMessagingHosts",
      ],
    },
    windows: {
      dataPath: ["Microsoft", "Edge", "User Data"],
      registryKey: "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts",
    },
  },
  vivaldi: {
    name: "Vivaldi",
    macos: {
      appName: "Vivaldi",
      dataPath: ["Library", "Application Support", "Vivaldi"],
      nativeMessagingPath: [
        "Library",
        "Application Support",
        "Vivaldi",
        "NativeMessagingHosts",
      ],
    },
    linux: {
      binaries: ["vivaldi", "vivaldi-stable"],
      dataPath: [".config", "vivaldi"],
      nativeMessagingPath: [".config", "vivaldi", "NativeMessagingHosts"],
    },
    windows: {
      dataPath: ["Vivaldi", "User Data"],
      registryKey: "HKCU\\Software\\Vivaldi\\NativeMessagingHosts",
    },
  },
  opera: {
    name: "Opera",
    macos: {
      appName: "Opera",
      dataPath: ["Library", "Application Support", "com.operasoftware.Opera"],
      nativeMessagingPath: [
        "Library",
        "Application Support",
        "com.operasoftware.Opera",
        "NativeMessagingHosts",
      ],
    },
    linux: {
      binaries: ["opera"],
      dataPath: [".config", "opera"],
      nativeMessagingPath: [".config", "opera", "NativeMessagingHosts"],
    },
    windows: {
      dataPath: ["Opera Software", "Opera Stable"],
      registryKey:
        "HKCU\\Software\\Opera Software\\Opera Stable\\NativeMessagingHosts",
      useRoaming: true,
    },
  },
};

/** Priority order for browser detection (most common first). */
export const BROWSER_DETECTION_ORDER: ChromiumBrowser[] = [
  "chrome",
  "brave",
  "arc",
  "edge",
  "chromium",
  "vivaldi",
  "opera",
];

// ── Path Helpers ─────────────────────────────────────────────────────

function getHome(): string {
  return getPlatform().env.get("HOME") ?? "/tmp";
}

/** Socket directory for native host connections. */
function getSocketDir(): string {
  return getPlatform().path.join(getHome(), ".hlvm", CHROME_BRIDGE_DIR_NAME);
}

/** Scan for all active socket files. */
export async function getAllSocketPaths(): Promise<string[]> {
  const platform = getPlatform();
  const dir = getSocketDir();
  const paths: string[] = [];
  try {
    for await (const entry of platform.fs.readDir(dir)) {
      if (entry.name.endsWith(".sock")) {
        paths.push(platform.path.join(dir, entry.name));
      }
    }
  } catch {
    // Directory may not exist
  }
  return paths;
}

/** Get native messaging host dirs for all detected browsers. */
export function getAllNativeMessagingHostsDirs(): {
  browser: ChromiumBrowser;
  path: string;
}[] {
  const platform = getPlatform();
  const home = getHome();
  const paths: { browser: ChromiumBrowser; path: string }[] = [];

  // macOS only for now (primary target)
  for (const browserId of BROWSER_DETECTION_ORDER) {
    const config = CHROMIUM_BROWSERS[browserId];
    if (config.macos.nativeMessagingPath.length > 0) {
      paths.push({
        browser: browserId,
        path: platform.path.join(home, ...config.macos.nativeMessagingPath),
      });
    }
  }

  return paths;
}

/** Detect which Chromium browser is installed (first match wins). */
export async function detectAvailableBrowser(): Promise<ChromiumBrowser | null> {
  const platform = getPlatform();
  for (const browserId of BROWSER_DETECTION_ORDER) {
    const config = CHROMIUM_BROWSERS[browserId];
    const appPath = `/Applications/${config.macos.appName}.app`;
    try {
      const info = await platform.fs.stat(appPath);
      if (info.isDirectory) return browserId;
    } catch {
      // Not found, continue
    }
  }
  return null;
}
