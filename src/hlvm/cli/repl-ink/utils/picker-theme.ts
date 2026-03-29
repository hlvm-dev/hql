import type { SemanticColors } from "../../theme/index.ts";

export type PickerTone =
  | "neutral"
  | "active"
  | "success"
  | "warning"
  | "error";

export interface PickerColors {
  readonly borderColor: string;
  readonly titleColor: string;
  readonly idleMarkerColor: string;
  readonly selectedMarkerColor: string;
  readonly rowForeground: string;
  readonly rowMeta: string;
  readonly rowMatch: string;
  readonly selectedBackground: string;
  readonly selectedForeground: string;
  readonly selectedMeta: string;
  readonly selectedMatch: string;
  readonly hintColor: string;
  readonly previewColor: string;
  readonly separatorColor: string;
  readonly emptyColor: string;
}

export function getPickerColors(
  sc: Pick<
    SemanticColors,
    "border" | "chrome" | "shell" | "status" | "text" | "surface"
  >,
  tone: PickerTone = "neutral",
): PickerColors {
  const borderColor = tone === "warning"
    ? sc.status.warning
    : tone === "success"
    ? sc.status.success
    : tone === "error"
    ? sc.status.error
    : tone === "active"
    ? sc.border.active
    : sc.border.default;
  const titleColor = tone === "warning"
    ? sc.status.warning
    : tone === "success"
    ? sc.status.success
    : tone === "error"
    ? sc.status.error
    : sc.text.primary;

  return {
    borderColor,
    titleColor,
    idleMarkerColor: sc.text.muted,
    selectedMarkerColor: sc.status.warning,
    rowForeground: sc.text.primary,
    rowMeta: sc.text.secondary,
    rowMatch: sc.status.warning,
    selectedBackground: sc.surface.inline.selectedBackground,
    selectedForeground: sc.surface.inline.selectedForeground,
    selectedMeta: sc.surface.inline.selectedForeground,
    selectedMatch: sc.status.warning,
    hintColor: sc.shell.queueHint,
    previewColor: sc.text.secondary,
    separatorColor: sc.chrome.separator,
    emptyColor: sc.text.muted,
  };
}
