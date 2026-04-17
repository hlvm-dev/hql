// Compat domain: permission-mode adapter.
//
// Purpose: the Shift+Tab permission-mode cycle currently flips a pure UI
// state (`default` / `accept-edits` / `plan`). For full CC parity this
// state must be consulted by the tool-execution layer before any Edit /
// Write / Bash call runs. This adapter is the single agreed-upon contract
// between the shell's UI state and the runtime's tool gate.
//
// STATUS: scaffold. PromptInput's local `permissionMode` React state is
// still the only source; TranscriptWorkbench / runtime host do NOT yet read
// it. Exit: route the prompt-side state through this adapter and have
// runtime/tool-execution honor it.

export type PermissionMode = "default" | "accept-edits" | "plan";

export interface PermissionAdapter {
  getMode(): PermissionMode;
  setMode(mode: PermissionMode): void;
  /** Tool gate. Return `false` to block the call; return `true` to allow. */
  shouldAllowToolCall(toolName: string): boolean;
}

export function cycleNext(current: PermissionMode): PermissionMode {
  return current === "default"
    ? "accept-edits"
    : current === "accept-edits"
    ? "plan"
    : "default";
}
