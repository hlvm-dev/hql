/**
 * Computer Use — drainRunLoop (HLVM bridge)
 *
 * CC's `drainRunLoop.ts` pumps the macOS CFRunLoop so DispatchQueue.main
 * promises from Swift `@MainActor` methods can resolve under Node/libuv.
 * HLVM doesn't use native modules — our bridge calls `osascript` subprocesses
 * which don't need CFRunLoop pumping. This is a no-op passthrough.
 */

export async function drainRunLoop<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}
