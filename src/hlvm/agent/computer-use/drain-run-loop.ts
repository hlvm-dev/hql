/**
 * Computer Use — drainRunLoop (HLVM bridge)
 *
 * CC's `drainRunLoop.ts` pumps the macOS CFRunLoop so that DispatchQueue.main
 * promises from Swift `@MainActor` methods can resolve under Node/libuv.
 * HLVM doesn't use native modules — our bridge calls `osascript` subprocesses
 * which don't need CFRunLoop pumping. This is a no-op passthrough.
 *
 * CC original: 79 lines (pump + retain/release + 30s timeout).
 * HLVM bridge: passthrough — just call fn() directly.
 */

/** No-op: just call fn(). No CFRunLoop pump needed without native modules. */
export async function drainRunLoop<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}

/** No-op: pump retain (CC uses for long-lived CGEventTap registration). */
export function retainPump(): void {
  // no-op
}

/** No-op: pump release. */
export function releasePump(): void {
  // no-op
}
