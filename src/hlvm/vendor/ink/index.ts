// Vendored Ink fork. The top-level deno.json maps the bare `"ink"` specifier
// here, so every `import ... from "ink"` in HLVM resolves to this engine rather
// than npm:ink@5. That keeps the runtime on React 19 + react-reconciler@0.31
// and avoids the `ReactCurrentOwner` crash from ink@5's pinned reconciler@0.29.

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
// Minimal `useStdout` shim compatible with components that read columns/rows
// (e.g. `repl-ink/components/Banner.tsx`). The shim returns the terminal-size
// context augmented with a `stdout.write` wrapper so consumers that call
// `.write(...)` still work.
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
