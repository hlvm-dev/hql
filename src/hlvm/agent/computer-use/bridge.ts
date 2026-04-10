/**
 * Computer Use — Bridge Layer
 *
 * Replaces CC's two proprietary native modules:
 *   - `@ant/computer-use-input` (Rust/enigo) → osascript CGEvent via JXA
 *   - `@ant/computer-use-swift` (Swift)       → screencapture + osascript NSScreen/NSWorkspace
 *
 * Provides `requireComputerUseInput()` and `requireComputerUseSwift()` with
 * the same API surface that CC's executor.ts calls. Also provides
 * `execFileNoThrow()` replacing CC's `../execFileNoThrow.js`.
 *
 * Bridge design: every method calls out to `osascript` or `screencapture`
 * subprocesses via `getPlatform().command.output()` (SSOT compliant).
 */

import { getPlatform } from "../../../platform/platform.ts";
import { getAgentLogger } from "../logger.ts";
import { parseKeySpec } from "./keycodes.ts";
import type {
  ComputerUseInputAPI,
  ComputerUseSwiftAPI,
  DisplayGeometry,
  InstalledApp,
  ResolvePrepareCaptureResult,
  RunningApp,
  ScreenshotResult,
} from "./types.ts";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Default timeout for osascript/JXA subprocess calls (30 seconds). */
const SUBPROCESS_TIMEOUT_MS = 30_000;

/** Run AppleScript and return trimmed stdout. */
async function osascript(
  script: string,
  timeout = SUBPROCESS_TIMEOUT_MS,
): Promise<string> {
  const result = await getPlatform().command.output({
    cmd: ["osascript", "-e", script],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    timeout,
  });
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr);
    throw new Error(`osascript failed (exit ${result.code}): ${stderr}`);
  }
  return new TextDecoder().decode(result.stdout).trim();
}

/** Run JXA (JavaScript for Automation with ObjC bridge). */
async function jxa(
  script: string,
  timeout = SUBPROCESS_TIMEOUT_MS,
): Promise<string> {
  const result = await getPlatform().command.output({
    cmd: ["osascript", "-l", "JavaScript", "-e", script],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    timeout,
  });
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr);
    throw new Error(`JXA failed (exit ${result.code}): ${stderr}`);
  }
  return new TextDecoder().decode(result.stdout).trim();
}

/** Validate that a numeric value is a finite number (guards against NaN/Infinity in JXA). */
function assertFiniteCoord(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${name}: ${value} (must be a finite number)`);
  }
}

// ── execFileNoThrow (replaces CC's ../execFileNoThrow.js) ────────────────

export async function execFileNoThrow(
  cmd: string,
  args: string[],
  opts?: { input?: string; useCwd?: boolean },
): Promise<{ stdout: string; stderr: string; code: number }> {
  const platform = getPlatform();

  if (opts?.input !== undefined) {
    // Pipe stdin directly — no shell redirect, no injection risk.
    const proc = platform.command.run({
      cmd: [cmd, ...args],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
      timeout: SUBPROCESS_TIMEOUT_MS,
    });
    const encoder = new TextEncoder();
    const writer = proc.stdin as WritableStream<Uint8Array>;
    const w = writer.getWriter();
    await w.write(encoder.encode(opts.input));
    await w.close();
    const status = await proc.status;
    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    if (proc.stdout) {
      const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        stdoutChunks.push(value);
      }
    }
    if (proc.stderr) {
      const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        stderrChunks.push(value);
      }
    }
    const decoder = new TextDecoder();
    return {
      stdout: decoder.decode(concatUint8Arrays(stdoutChunks)),
      stderr: decoder.decode(concatUint8Arrays(stderrChunks)),
      code: status.code,
    };
  }

  const result = await platform.command.output({
    cmd: [cmd, ...args],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    timeout: SUBPROCESS_TIMEOUT_MS,
  });
  return {
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    code: result.code,
  };
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0];
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

// ── ComputerUseInput (replaces @ant/computer-use-input / Rust enigo) ─────

let _inputInstance: ComputerUseInputAPI | undefined;

export function requireComputerUseInput(): ComputerUseInputAPI {
  if (_inputInstance) return _inputInstance;

  _inputInstance = {
    async moveMouse(x: number, y: number, _animated: boolean): Promise<void> {
      assertFiniteCoord(x, "x");
      assertFiniteCoord(y, "y");
      await jxa(`
        ObjC.import('CoreGraphics');
        var pt = $.CGPointMake(${x}, ${y});
        var ev = $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, pt, 0);
        $.CGEventPost($.kCGHIDEventTap, ev);
      `);
    },

    async mouseButton(
      button: "left" | "right" | "middle",
      action: "click" | "press" | "release",
      count?: number,
    ): Promise<void> {
      const buttonMap = {
        left: {
          down: "kCGEventLeftMouseDown",
          up: "kCGEventLeftMouseUp",
          btn: 0,
        },
        right: {
          down: "kCGEventRightMouseDown",
          up: "kCGEventRightMouseUp",
          btn: 1,
        },
        middle: {
          down: "kCGEventOtherMouseDown",
          up: "kCGEventOtherMouseUp",
          btn: 2,
        },
      };
      if (!(button in buttonMap)) {
        throw new Error(`Invalid mouse button: "${button}". Must be "left", "right", or "middle".`);
      }
      const { down, up, btn } = buttonMap[button];

      if (action === "press") {
        await jxa(`
          ObjC.import('CoreGraphics');
          var loc = $.CGEventGetLocation($.CGEventCreate(null));
          var ev = $.CGEventCreateMouseEvent(null, $.${down}, loc, ${btn});
          $.CGEventPost($.kCGHIDEventTap, ev);
        `);
      } else if (action === "release") {
        await jxa(`
          ObjC.import('CoreGraphics');
          var loc = $.CGEventGetLocation($.CGEventCreate(null));
          var ev = $.CGEventCreateMouseEvent(null, $.${up}, loc, ${btn});
          $.CGEventPost($.kCGHIDEventTap, ev);
        `);
      } else {
        // click — AppKit computes clickCount from timing + position proximity
        const n = count ?? 1;
        for (let i = 0; i < n; i++) {
          await jxa(`
            ObjC.import('CoreGraphics');
            var loc = $.CGEventGetLocation($.CGEventCreate(null));
            var evDown = $.CGEventCreateMouseEvent(null, $.${down}, loc, ${btn});
            $.CGEventSetIntegerValueField(evDown, $.kCGMouseEventClickState, ${i + 1});
            $.CGEventPost($.kCGHIDEventTap, evDown);
            var evUp = $.CGEventCreateMouseEvent(null, $.${up}, loc, ${btn});
            $.CGEventSetIntegerValueField(evUp, $.kCGMouseEventClickState, ${i + 1});
            $.CGEventPost($.kCGHIDEventTap, evUp);
          `);
        }
      }
    },

    async mouseScroll(
      delta: number,
      axis: "vertical" | "horizontal",
    ): Promise<void> {
      assertFiniteCoord(delta, "scroll delta");
      if (axis === "vertical") {
        await jxa(`
          ObjC.import('CoreGraphics');
          var ev = $.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitPixel, 1, ${Math.round(delta)});
          $.CGEventPost($.kCGHIDEventTap, ev);
        `);
      } else {
        await jxa(`
          ObjC.import('CoreGraphics');
          var ev = $.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitPixel, 2, 0, ${Math.round(delta)});
          $.CGEventPost($.kCGHIDEventTap, ev);
        `);
      }
    },

    async mouseLocation(): Promise<{ x: number; y: number }> {
      const raw = await jxa(`
        ObjC.import('CoreGraphics');
        var ev = $.CGEventCreate(null);
        var loc = $.CGEventGetLocation(ev);
        JSON.stringify({ x: loc.x, y: loc.y });
      `);
      return JSON.parse(raw);
    },

    async keys(parts: string[]): Promise<void> {
      if (parts.length === 0) return;
      // CC: input.keys(['command', 'v']) → press all modifiers, hit key, release
      // Last part is the key, rest are modifiers
      const keyName = parts[parts.length - 1];
      const modNames = parts.slice(0, -1);

      // Map CC modifier names (e.g. 'command', 'shift') to our MODIFIER_MAP
      const parsed = parseKeySpec(
        modNames.length > 0
          ? `${modNames.join("+")}+${keyName}`
          : keyName,
      );
      if (!parsed) {
        throw new Error(`Unknown key spec: "${parts.join("+")}"`);
      }

      const modClause = parsed.modifiers.length > 0
        ? ` using {${parsed.modifiers.join(", ")}}`
        : "";
      await osascript(
        `tell application "System Events" to key code ${parsed.keyCode}${modClause}`,
      );
    },

    async key(
      name: string,
      action: "press" | "release",
    ): Promise<void> {
      // CC: input.key('shift', 'press') / input.key('shift', 'release')
      // Map modifier names to key codes
      const effectiveName = name.toLowerCase();

      // Check if it's a modifier name that maps differently
      const modifierKeyCode: Record<string, number> = {
        command: 55,
        cmd: 55,
        shift: 56,
        option: 58,
        alt: 58,
        control: 59,
        ctrl: 59,
        fn: 63,
      };

      let keyCode: number;
      if (effectiveName in modifierKeyCode) {
        keyCode = modifierKeyCode[effectiveName];
      } else {
        const parsed = parseKeySpec(effectiveName);
        if (!parsed) throw new Error(`Unknown key: "${name}"`);
        keyCode = parsed.keyCode;
      }

      const isDown = action === "press";
      await jxa(`
        ObjC.import('CoreGraphics');
        var ev = $.CGEventCreateKeyboardEvent(null, ${keyCode}, ${isDown});
        $.CGEventPost($.kCGHIDEventTap, ev);
      `);
    },

    async typeText(text: string): Promise<void> {
      // Strip NULL bytes (truncate C strings) and other non-printable
      // control chars that AppleScript's keystroke can't handle.
      // deno-lint-ignore no-control-regex
      const sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
      const escaped = sanitized
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
      await osascript(
        `tell application "System Events" to keystroke "${escaped}"`,
      );
    },

    // Bridge note: CC's getFrontmostAppInfo() is synchronous (Rust native module).
    // In HLVM, osascript is async. The executor's getFrontmostApp() calls this
    // and awaits it — this is the one executor.ts change from CC's original.
    async getFrontmostAppInfo(): Promise<{
      bundleId: string;
      appName: string;
    } | null> {
      try {
        const raw = await jxa(`
          ObjC.import('AppKit');
          var app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
          JSON.stringify({
            bundleId: ObjC.unwrap(app.bundleIdentifier),
            appName: ObjC.unwrap(app.localizedName)
          });
        `);
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
  };

  return _inputInstance;
}

// ── ComputerUseSwift (replaces @ant/computer-use-swift) ──────────────────

let _swiftInstance: ComputerUseSwiftAPI | undefined;

export function requireComputerUseSwift(): ComputerUseSwiftAPI {
  if (_swiftInstance) return _swiftInstance;

  const log = getAgentLogger();

  _swiftInstance = {
    _drainMainRunLoop(): void {
      // No-op: no native modules → no CFRunLoop to pump
    },

    display: {
      getSize(displayId?: number): DisplayGeometry {
        // Synchronous in CC's Swift module. We cache from async init.
        // For first call, return default. Caller should use async getDisplaySize().
        // This is used by executor's screenshot/zoom methods which are async anyway.
        return _cachedDisplaySize ?? {
          width: 1920,
          height: 1080,
          scaleFactor: 2,
          displayId: displayId ?? 1,
        };
      },

      listAll(): DisplayGeometry[] {
        return _cachedDisplayList ?? [this.getSize()];
      },
    },

    screenshot: {
      async captureExcluding(
        _allowedBundleIds: string[],
        quality: number,
        targetW: number,
        targetH: number,
        _displayId?: number,
      ): Promise<ScreenshotResult> {
        return captureScreenshot(quality, targetW, targetH);
      },

      async captureRegion(
        _allowedBundleIds: string[],
        x: number,
        y: number,
        w: number,
        h: number,
        outW: number,
        outH: number,
        quality: number,
        _displayId?: number,
      ): Promise<{ base64: string; width: number; height: number }> {
        return captureScreenshotRegion(x, y, w, h, outW, outH, quality);
      },
    },

    apps: {
      async prepareDisplay(
        allowedBundleIds: string[],
        hostBundleId: string,
        _displayId?: number,
      ): Promise<{ activated: string | null; hidden: string[] }> {
        // Activate the first allowed app that's running (bring to front).
        // Hide apps NOT in the allowlist and NOT the host terminal.
        // This ensures CU actions target the correct window.
        const allowSet = new Set(allowedBundleIds);
        allowSet.add(hostBundleId); // Never hide the terminal
        try {
          const result = await jxa(`
            ObjC.import('AppKit');
            var ws = $.NSWorkspace.sharedWorkspace;
            var apps = ws.runningApplications;
            var hidden = [];
            var activated = null;
            var allowSet = new Set(${JSON.stringify([...allowSet])});
            for (var i = 0; i < apps.count; i++) {
              var app = apps.objectAtIndex(i);
              var bid = app.bundleIdentifier?.js;
              if (!bid) continue;
              var policy = app.activationPolicy;
              if (policy !== $.NSApplicationActivationPolicyRegular) continue;
              if (allowSet.has(bid)) {
                if (!activated) {
                  app.activateWithOptions($.NSApplicationActivateIgnoringOtherApps);
                  activated = bid;
                }
              } else if (!app.isHidden) {
                app.hide();
                hidden.push(bid);
              }
            }
            JSON.stringify({ activated: activated, hidden: hidden });
          `);
          return JSON.parse(result);
        } catch (err) {
          log.debug(
            `[bridge] prepareDisplay failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return { activated: null, hidden: [] };
        }
      },

      async previewHideSet(
        _bundleIds: string[],
        _displayId?: number,
      ): Promise<Array<{ bundleId: string; displayName: string }>> {
        return [];
      },

      async findWindowDisplays(
        _bundleIds: string[],
      ): Promise<Array<{ bundleId: string; displayIds: number[] }>> {
        log.debug("[bridge] findWindowDisplays: stub");
        return [];
      },

      async listInstalled(): Promise<InstalledApp[]> {
        // CC uses Spotlight/LSCopyApplicationURLsForBundleIdentifier (Swift).
        // HLVM: use mdfind to query Spotlight for .app bundles, then read
        // bundle IDs via defaults read. Falls back to running apps with paths.
        try {
          const raw = await jxa(`
            ObjC.import('AppKit');
            ObjC.import('CoreServices');
            var fm = $.NSFileManager.defaultManager;
            var appDirs = ['/Applications', '/System/Applications'];
            var home = ObjC.unwrap($.NSHomeDirectory());
            if (home) appDirs.push(home + '/Applications');
            var result = [];
            for (var d = 0; d < appDirs.length; d++) {
              var dir = appDirs[d];
              var contents = fm.contentsOfDirectoryAtPathError(dir, null);
              if (!contents) continue;
              for (var i = 0; i < contents.count; i++) {
                var name = ObjC.unwrap(contents.objectAtIndex(i));
                if (!name.endsWith('.app')) continue;
                var path = dir + '/' + name;
                var bundle = $.NSBundle.bundleWithPath(path);
                if (!bundle) continue;
                var bid = ObjC.unwrap(bundle.bundleIdentifier);
                var displayName = name.replace(/\\.app$/, '');
                if (bid) result.push({ bundleId: bid, displayName: displayName, path: path });
              }
            }
            JSON.stringify(result);
          `);
          return JSON.parse(raw);
        } catch {
          return [];
        }
      },

      iconDataUrl(_path: string): string | null {
        // Would need async call — return null, matches CC's fallback
        return null;
      },

      listRunning(): RunningApp[] {
        // Synchronous in CC's Swift module. Return cached.
        return _cachedRunningApps ?? [];
      },

      async open(bundleId: string): Promise<void> {
        // Defense-in-depth: validate bundle ID before passing to osascript
        if (!bundleId || !/^[\w.-]+$/.test(bundleId)) {
          throw new Error(`Invalid bundle ID: "${bundleId}"`);
        }
        await osascript(
          `tell application id "${bundleId}" to activate`,
        );
      },

      async unhide(bundleIds: string[]): Promise<void> {
        for (const bid of bundleIds) {
          try {
            await osascript(
              `tell application id "${bid}" to activate`,
            );
          } catch {
            // best-effort
          }
        }
      },

      async appUnderPoint(
        _x: number,
        _y: number,
      ): Promise<{ bundleId: string; displayName: string } | null> {
        log.debug("[bridge] appUnderPoint: stub");
        return null;
      },
    },

    async resolvePrepareCapture(
      _allowedBundleIds: string[],
      _hostBundleId: string,
      quality: number,
      targetW: number,
      targetH: number,
      _displayId?: number,
      _autoResolve?: boolean,
      _doHide?: boolean,
    ): Promise<ResolvePrepareCaptureResult> {
      const screenshot = await captureScreenshot(quality, targetW, targetH);
      return {
        displayId: 1,
        hidden: [],
        screenshot,
      };
    },

    hotkey: {
      registerEscape(_callback: () => void): boolean {
        return false; // no CGEventTap
      },
      unregister(): void {
        // no-op
      },
      notifyExpectedEscape(): void {
        // no-op
      },
    },
  };

  // Async init: populate caches
  _displayCacheReady = initDisplayCache().catch(() => {});
  _runningAppsReady = initRunningAppsCache().catch(() => {});

  return _swiftInstance;
}

// ── Display cache (bridge sync→async adaptation) ─────────────────────────

let _cachedDisplaySize: DisplayGeometry | undefined;
let _cachedDisplayList: DisplayGeometry[] | undefined;
let _cachedRunningApps: RunningApp[] | undefined;
let _displayCacheReady: Promise<void> | undefined;
let _runningAppsReady: Promise<void> | undefined;

async function initDisplayCache(): Promise<void> {
  try {
    const raw = await jxa(`
      ObjC.import('AppKit');
      var screens = $.NSScreen.screens;
      var result = [];
      for (var i = 0; i < screens.count; i++) {
        var s = screens.objectAtIndex(i);
        var frame = s.frame;
        var desc = s.deviceDescription;
        var displayId = ObjC.unwrap(desc.objectForKey($("NSScreenNumber")));
        var backingScale = s.backingScaleFactor;
        result.push({
          width: frame.size.width,
          height: frame.size.height,
          scaleFactor: backingScale,
          displayId: displayId,
          originX: frame.origin.x,
          originY: frame.origin.y
        });
      }
      JSON.stringify(result);
    `);
    const displays: DisplayGeometry[] = JSON.parse(raw);
    _cachedDisplayList = displays;
    if (displays.length > 0) {
      _cachedDisplaySize = displays[0];
    }
  } catch {
    // Fall back to defaults
  }
}

async function initRunningAppsCache(): Promise<void> {
  try {
    const raw = await jxa(`
      ObjC.import('AppKit');
      var apps = $.NSWorkspace.sharedWorkspace.runningApplications;
      var result = [];
      for (var i = 0; i < apps.count; i++) {
        var app = apps.objectAtIndex(i);
        var policy = app.activationPolicy;
        if (policy === $.NSApplicationActivationPolicyRegular) {
          var bid = ObjC.unwrap(app.bundleIdentifier);
          var name = ObjC.unwrap(app.localizedName);
          if (bid && name) result.push({ bundleId: bid, displayName: name });
        }
      }
      JSON.stringify(result);
    `);
    _cachedRunningApps = JSON.parse(raw);
  } catch {
    // Fall back to empty
  }
}

/** Refresh display cache. Called before screenshot to ensure accurate dims. */
export async function refreshDisplayCache(): Promise<void> {
  await initDisplayCache();
}

/**
 * Invalidate all cached state (display, running apps).
 * Called when a fresh CU lock is acquired to ensure the new session
 * starts with accurate system state.
 */
export function invalidateCaches(): void {
  _cachedDisplaySize = undefined;
  _cachedDisplayList = undefined;
  _cachedRunningApps = undefined;
  _displayCacheReady = undefined;
  _runningAppsReady = undefined;
}

/** Ensure display cache is populated. Await before reading getSize(). */
export async function ensureDisplayCache(): Promise<void> {
  if (_displayCacheReady) await _displayCacheReady;
  if (!_cachedDisplaySize) await initDisplayCache();
}

/** Ensure running apps cache is populated. Await before reading listRunning(). */
export async function ensureRunningAppsCache(): Promise<void> {
  if (_runningAppsReady) await _runningAppsReady;
  if (!_cachedRunningApps) await initRunningAppsCache();
}

// ── Screenshot implementation ────────────────────────────────────────────

async function captureScreenshot(
  quality: number,
  targetW: number,
  targetH: number,
): Promise<ScreenshotResult> {
  const platform = getPlatform();
  const tmpDir = await platform.fs.makeTempDir({ prefix: "hlvm-cu" });
  const tmpPath = platform.path.join(tmpDir, `screenshot-${Date.now()}.jpg`);

  try {
    // Capture full screen
    const capResult = await platform.command.output({
      cmd: ["screencapture", "-x", "-t", "jpg", tmpPath],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    if (!capResult.success) {
      throw new Error(
        `screencapture failed: ${new TextDecoder().decode(capResult.stderr)}`,
      );
    }

    // Resize to target dimensions
    await platform.command.output({
      cmd: [
        "sips",
        "--resampleWidth",
        String(targetW),
        "--resampleHeight",
        String(targetH),
        "--setProperty",
        "formatOptions",
        String(Math.round(quality * 100)),
        tmpPath,
      ],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });

    // Read and encode
    const bytes = await platform.fs.readFile(tmpPath);
    const base64 = btoa(
      Array.from(bytes, (b) => String.fromCharCode(b)).join(""),
    );

    return { base64, width: targetW, height: targetH };
  } finally {
    try {
      await platform.fs.remove(tmpDir, { recursive: true });
    } catch { /* ignore */ }
  }
}

async function captureScreenshotRegion(
  x: number,
  y: number,
  w: number,
  h: number,
  outW: number,
  outH: number,
  quality: number,
): Promise<{ base64: string; width: number; height: number }> {
  const platform = getPlatform();
  const tmpDir = await platform.fs.makeTempDir({ prefix: "hlvm-cu" });
  const tmpPath = platform.path.join(tmpDir, `region-${Date.now()}.jpg`);

  try {
    // Capture region: screencapture -x -t jpg -R x,y,w,h
    const capResult = await platform.command.output({
      cmd: [
        "screencapture",
        "-x",
        "-t",
        "jpg",
        "-R",
        `${x},${y},${w},${h}`,
        tmpPath,
      ],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    if (!capResult.success) {
      throw new Error(
        `screencapture region failed: ${new TextDecoder().decode(capResult.stderr)}`,
      );
    }

    // Resize to target dimensions
    await platform.command.output({
      cmd: [
        "sips",
        "--resampleWidth",
        String(outW),
        "--resampleHeight",
        String(outH),
        "--setProperty",
        "formatOptions",
        String(Math.round(quality * 100)),
        tmpPath,
      ],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });

    const bytes = await platform.fs.readFile(tmpPath);
    const base64 = btoa(
      Array.from(bytes, (b) => String.fromCharCode(b)).join(""),
    );

    return { base64, width: outW, height: outH };
  } finally {
    try {
      await platform.fs.remove(tmpDir, { recursive: true });
    } catch { /* ignore */ }
  }
}
