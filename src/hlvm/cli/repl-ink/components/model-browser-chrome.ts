import {
  buildBalancedTextRow,
  type TwoColumnTextLayout,
} from "../utils/display-chrome.ts";
import { truncate } from "../../../../common/utils.ts";
import { MODEL_BROWSER_FOCUSED_LABEL } from "./model-browser-status.ts";

export function buildModelBrowserScopeText(
  selectionScopeTitle: string,
  currentModel: string | undefined,
  maxModelWidth: number,
): string {
  return currentModel
    ? `${selectionScopeTitle}: ${truncate(currentModel, maxModelWidth, "…")}`
    : `${selectionScopeTitle}: none`;
}

export function buildModelBrowserViewLayout(
  width: number,
  filterLabel: string,
  modelCountLabel: string,
  nextFilterLabel: string,
): TwoColumnTextLayout {
  return buildBalancedTextRow(
    width,
    `Showing ${filterLabel} (${modelCountLabel})`,
    `Tab → ${nextFilterLabel}`,
    {
      maxRightWidth: Math.max(10, Math.floor(width * 0.34)),
    },
  );
}

export function buildModelBrowserFocusLayout(
  width: number,
  selectedModelName: string | undefined,
  statusLabel: string | undefined,
): TwoColumnTextLayout {
  return buildBalancedTextRow(
    width,
    `${MODEL_BROWSER_FOCUSED_LABEL}: ${selectedModelName ?? "None"}`,
    selectedModelName && statusLabel ? `[${statusLabel}]` : "",
    { maxRightWidth: Math.max(10, Math.floor(width * 0.26)) },
  );
}
