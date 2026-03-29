import React from "react";
import { Text } from "ink";
import { useSemanticColors } from "../../theme/index.ts";
import type { PickerTone } from "../utils/picker-theme.ts";

export type ChromeChipTone = PickerTone;

interface ChromeChipProps {
  text: string;
  tone?: ChromeChipTone;
}

export function ChromeChip({
  text,
  tone = "neutral",
}: ChromeChipProps): React.ReactElement {
  const sc = useSemanticColors();
  const colors = tone === "warning"
    ? sc.chrome.chipWarning
    : tone === "success"
    ? sc.chrome.chipSuccess
    : tone === "error"
    ? sc.chrome.chipError
    : tone === "active"
    ? sc.chrome.chipActive
    : sc.chrome.chipNeutral;

  return (
    <Text backgroundColor={colors.background} color={colors.foreground}>
      {" "}
      {text}
      {" "}
    </Text>
  );
}
