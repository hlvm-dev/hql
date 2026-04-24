// Barrel for bare `ink` imports inside src/hlvm/tui-v2/.
// v2's deno.json maps `"ink"` here so any file reached from the v2 tree —
// including v1 repl-ink files transiently pulled in during the composer
// migration — resolves to the local CC donor engine rather than npm ink@5.
// This keeps the runtime on React 19 + react-reconciler@0.31 and avoids the
// ReactCurrentOwner crash from ink@5's pinned reconciler@0.29.

export { default as Box } from "./components/Box.tsx";
export type { Props as BoxProps } from "./components/Box.tsx";
export { default as Text } from "./components/Text.tsx";
export type { Props as TextProps } from "./components/Text.tsx";
export {
  type Instance,
  type RenderOptions,
  renderSync as render,
  type Root,
} from "./root.ts";
export type { Key } from "./events/input-event.ts";
export { default as useInput } from "./hooks/use-input.ts";
export { default as useApp } from "./hooks/use-app.ts";
export type { DOMElement } from "./dom.ts";
export { default as measureElement } from "./measure-element.ts";
// Minimal `useStdout` shim compatible with v1 components reused via this
// barrel (e.g. `repl-ink/components/Banner.tsx` reads columns/rows).
// The shim returns the v2 terminal-size context augmented with a
// `stdout.write` wrapper so consumers that call `.write(...)` still work.
// Do not use this to express real stdout features CC donors need — this is
// strictly an SSOT-reuse bridge for shared v1 components.
import { useTerminalSize as _useTerminalSizeForStdout } from "../hooks/useTerminalSize.ts";
import { getPlatform as _getPlatformForStdout } from "../../../platform/platform.ts";
export function useStdout(): {
  stdout: {
    columns: number;
    rows: number;
    write: (data: string | Uint8Array) => void;
  };
  write: (data: string | Uint8Array) => void;
} {
  const size = _useTerminalSizeForStdout();
  const write = (data: string | Uint8Array) => {
    const bytes = typeof data === "string"
      ? new TextEncoder().encode(data)
      : data;
    try {
      // Route through the platform abstraction per SSOT. Bypassing this
      // with `Deno.stdout.writeSync` trips the deno-leak SSOT check.
      _getPlatformForStdout().terminal.stdout.writeSync(bytes);
    } catch {
      // swallow — never re-enter TUI rendering path
    }
  };
  return {
    stdout: { columns: size.columns, rows: size.rows, write },
    write,
  };
}
