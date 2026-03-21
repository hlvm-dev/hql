import {
  buildBalancedTextRow,
  buildRightSlotTextLayout,
  buildSectionLabelText,
  type TwoColumnTextLayout,
} from "./display-chrome.ts";

export const COMMAND_PALETTE_SHORTCUT_WIDTH = 12;

export function buildPaletteHeaderLayout(
  {
    query,
    resultCount,
    selectedCount,
    rebindMode,
  }: {
    query: string;
    resultCount: number;
    selectedCount: number;
    rebindMode: boolean;
  },
  contentWidth: number,
): TwoColumnTextLayout {
  if (rebindMode) {
    return buildBalancedTextRow(
      contentWidth,
      "Rebind selected shortcut",
      selectedCount > 0 ? `${selectedCount} ready` : "",
    );
  }

  const left = query.trim().length > 0 ? "Filter commands" : "Search commands";
  const right = resultCount === 1 ? "1 match" : `${resultCount} matches`;
  return buildBalancedTextRow(contentWidth, left, right);
}

export function buildPaletteCategoryLabel(
  category: string,
  contentWidth: number,
): string {
  return buildSectionLabelText(category, contentWidth);
}

export function buildPaletteItemLayout(
  label: string,
  shortcut: string,
  contentWidth: number,
): TwoColumnTextLayout {
  return buildRightSlotTextLayout(
    contentWidth,
    label,
    shortcut,
    COMMAND_PALETTE_SHORTCUT_WIDTH,
  );
}
