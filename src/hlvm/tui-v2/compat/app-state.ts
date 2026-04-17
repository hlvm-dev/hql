// Compat domain: shell-level app state.
//
// Purpose: give the v2 TUI a single place to read "what dialog is open?",
// "is the shell in fullscreen?", "which pane has focus?" without each
// component reaching into a different CC or v1 source of truth.
//
// STATUS: scaffold. Fill in when the first component needs a shared
// cross-cutting app-state read.

export type AppModalOverlay =
  | "none"
  | "help"
  | "permission"
  | "model-picker"
  | "transcript-viewer"
  | "history-search"
  | "transcript-search";

export interface AppStateSnapshot {
  readonly modalOverlay: AppModalOverlay;
  readonly isFullscreen: boolean;
  readonly focus: "prompt" | "transcript" | "overlay";
}

export const INITIAL_APP_STATE: AppStateSnapshot = {
  modalOverlay: "none",
  isFullscreen: true,
  focus: "prompt",
};
