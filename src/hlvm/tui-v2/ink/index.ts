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
export type { Key } from "./events/input-event.js";
