import type { AppAction, AppState } from "./types.ts";

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "set_input":
      return { ...state, inputText: action.text, cursorOffset: action.cursor };
    case "toggle_mode":
      return {
        ...state,
        inputMode: state.inputMode === "chat" ? "code" : "chat",
      };
    case "set_overlay":
      return { ...state, activeOverlay: action.overlay };
    case "set_loading":
      return { ...state, isLoading: action.loading };
    case "set_model":
      return {
        ...state,
        activeModelId: action.id,
        activeModelDisplay: action.display,
      };
    case "set_token_count":
      return { ...state, tokenCount: action.count };
    default:
      return state;
  }
}
