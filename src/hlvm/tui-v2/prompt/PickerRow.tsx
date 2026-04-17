import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import { HighlightedText } from "./HighlightedText.tsx";

type TruncateMode = "start" | "end" | "none";

export interface PickerColors {
  readonly idleMarkerColor: string;
  readonly selectedMarkerColor: string;
  readonly rowForeground: string;
  readonly rowMeta: string;
  readonly rowMatch: string;
  readonly selectedBackground: string;
  readonly selectedForeground: string;
  readonly selectedMeta: string;
  readonly selectedMatch: string;
}

type Props = {
  readonly label: string;
  readonly pickerColors: PickerColors;
  readonly isSelected: boolean;
  readonly width?: number;
  readonly markerText: string;
  readonly markerWidth: number;
  readonly matchIndices?: readonly number[];
  readonly maxLabelWidth?: number;
  readonly truncate?: TruncateMode;
  readonly metaText?: string;
  readonly metaWidth?: number;
  readonly suffixText?: string;
  readonly suffixColor?: string;
  readonly labelBold?: boolean;
};

function truncateWithIndices(
  label: string,
  maxWidth: number,
  strategy: TruncateMode,
  indices?: readonly number[],
): { label: string; indices: readonly number[] } {
  if (strategy === "none" || label.length <= maxWidth) {
    return { label, indices: indices ?? [] };
  }

  if (strategy === "start") {
    const offset = label.length - (maxWidth - 1);
    const truncated = "…" + label.slice(offset);
    const adjusted = (indices ?? [])
      .map((index) => index - offset + 1)
      .filter((index) => index > 0 && index < truncated.length);
    return { label: truncated, indices: adjusted };
  }

  const truncated = label.slice(0, maxWidth - 1) + "…";
  const adjusted = (indices ?? []).filter((index) => index < maxWidth - 1);
  return { label: truncated, indices: adjusted };
}

export function PickerRow({
  label,
  pickerColors,
  isSelected,
  width,
  markerText,
  markerWidth,
  matchIndices,
  maxLabelWidth,
  truncate = "none",
  metaText,
  metaWidth = 10,
  suffixText,
  suffixColor,
  labelBold = false,
}: Props): React.ReactElement {
  const selectedBackground = isSelected
    ? pickerColors.selectedBackground
    : undefined;
  const labelColor = isSelected
    ? pickerColors.selectedForeground
    : pickerColors.rowForeground;
  const matchColor = isSelected
    ? pickerColors.selectedMatch
    : pickerColors.rowMatch;
  const metaColor = isSelected
    ? pickerColors.selectedMeta
    : pickerColors.rowMeta;
  const markerColor = isSelected
    ? pickerColors.selectedMarkerColor
    : pickerColors.idleMarkerColor;
  const availableLabelWidth = width === undefined
    ? undefined
    : Math.max(1, width - markerWidth - 1 - (metaText ? metaWidth : 0));
  const effectiveLabelWidth = availableLabelWidth === undefined
    ? maxLabelWidth
    : Math.min(maxLabelWidth ?? availableLabelWidth, availableLabelWidth);
  const labelContent = effectiveLabelWidth === undefined
    ? (
      <HighlightedText
        text={label}
        matchIndices={matchIndices}
        baseColor={labelColor}
        highlightColor={matchColor}
        backgroundColor={selectedBackground}
        bold={labelBold}
      />
    )
    : (() => {
      const next = truncateWithIndices(
        label,
        effectiveLabelWidth,
        truncate,
        matchIndices,
      );
      return (
        <HighlightedText
          text={next.label}
          matchIndices={next.indices.length > 0 ? next.indices : undefined}
          baseColor={labelColor}
          highlightColor={matchColor}
          backgroundColor={selectedBackground}
          bold={labelBold}
        />
      );
    })();

  return (
    <Box width={width}>
      <Box width={markerWidth}>
        <Text
          backgroundColor={selectedBackground}
          color={markerColor}
          bold={isSelected}
        >
          {markerText}
        </Text>
      </Box>
      <Text backgroundColor={selectedBackground}>{" "}</Text>
      {effectiveLabelWidth === undefined
        ? <Box flexGrow={1}>{labelContent}</Box>
        : <Box width={effectiveLabelWidth}>{labelContent}</Box>}
      {suffixText && (
        <Text
          backgroundColor={selectedBackground}
          color={suffixColor ?? metaColor}
        >
          {suffixText}
        </Text>
      )}
      {metaText && (
        <Box width={metaWidth} justifyContent="flex-end">
          <Text
            backgroundColor={selectedBackground}
            color={metaColor}
            dimColor={!isSelected}
          >
            {metaText}
          </Text>
        </Box>
      )}
    </Box>
  );
}
