export type InputMode = "chat" | "code";
export type OverlayKind = "none" | "model-selector" | "config" | "help";

export interface AppState {
  inputMode: InputMode;
  inputText: string;
  cursorOffset: number;
  activeModelId: string | null;
  activeModelDisplay: string;
  activeOverlay: OverlayKind;
  isLoading: boolean;
  tokenCount: number;
}

export type AppAction =
  | { type: "set_input"; text: string; cursor: number }
  | { type: "toggle_mode" }
  | { type: "set_overlay"; overlay: OverlayKind }
  | { type: "set_loading"; loading: boolean }
  | { type: "set_model"; id: string; display: string }
  | { type: "set_token_count"; count: number };

export function initialAppState(): AppState {
  return {
    inputMode: "chat",
    inputText: "",
    cursorOffset: 0,
    activeModelId: null,
    activeModelDisplay: "auto",
    activeOverlay: "none",
    isLoading: false,
    tokenCount: 0,
  };
}
