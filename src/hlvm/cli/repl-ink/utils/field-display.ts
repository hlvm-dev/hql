import { truncate } from "../../../../common/utils.ts";
import { buildCursorWindowDisplay } from "./cursor-window.ts";

export interface FieldDisplayState {
  beforeCursor: string;
  cursorChar: string;
  afterCursor: string;
  renderWidth: number;
  placeholderText: string;
  isPlaceholder: boolean;
}

export function buildFieldDisplayState(
  value: string,
  cursor: number,
  width: number,
  placeholder: string,
): FieldDisplayState {
  const visibleChars = Math.max(1, width);
  if (value.length === 0) {
    return {
      beforeCursor: "",
      cursorChar: " ",
      afterCursor: "",
      renderWidth: 1,
      placeholderText: truncate(
        placeholder,
        Math.max(1, visibleChars - 1),
        "…",
      ),
      isPlaceholder: true,
    };
  }

  const display = buildCursorWindowDisplay(value, cursor, visibleChars);
  return {
    beforeCursor: display.beforeCursor,
    cursorChar: display.cursorChar,
    afterCursor: display.afterCursor,
    renderWidth: display.renderWidth,
    placeholderText: "",
    isPlaceholder: false,
  };
}
