import React, { useMemo } from "react";
import type {
  CompletionItem,
  ProviderId,
} from "../../cli/repl-ink/completion/types.ts";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import { DONOR_INACTIVE, DONOR_USER_MESSAGE_BACKGROUND } from "../theme/donorTheme.ts";
import { HighlightedText } from "./HighlightedText.tsx";
import { PickerRow, type PickerColors } from "./PickerRow.tsx";
import {
  COMPLETION_PANEL_MAX_WIDTH,
  COMPLETION_PANEL_MIN_WIDTH,
  measureCompletionPanelWidth,
} from "../../cli/repl-ink/utils/completion-layout.ts";
import { calculateScrollWindow } from "../../cli/repl-ink/completion/navigation.ts";

const SELECTOR_COLUMN_WIDTH = 2;
const META_COLUMN_WIDTH = 10;
const COMMAND_MARKER_WIDTH = 2;
const COMMAND_MIN_LABEL_WIDTH = 12;
const COMMAND_MAX_LABEL_WIDTH = 18;
const MAX_VISIBLE_ITEMS = 6;

const PICKER_COLORS: PickerColors = {
  idleMarkerColor: DONOR_INACTIVE,
  selectedMarkerColor: "yellow",
  rowForeground: "white",
  rowMeta: DONOR_INACTIVE,
  rowMatch: "yellow",
  selectedBackground: DONOR_USER_MESSAGE_BACKGROUND,
  selectedForeground: "white",
  selectedMeta: "white",
  selectedMatch: "yellow",
};

type Props = {
  readonly items: readonly CompletionItem[];
  readonly selectedIndex: number;
  readonly helpText: string;
  readonly isLoading: boolean;
  readonly providerId?: ProviderId;
  readonly marginLeft?: number;
  readonly width?: number;
  readonly showDocPanel?: boolean;
};

type CommandItemRowProps = {
  readonly item: CompletionItem;
  readonly isSelected: boolean;
  readonly commandColumnWidth: number;
  readonly width: number;
};

function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width === 1) return "…";
  return text.slice(0, width - 1) + "…";
}

function CommandItemRow({
  item,
  isSelected,
  commandColumnWidth,
  width,
}: CommandItemRowProps): React.ReactElement {
  const spec = item.getRenderSpec();
  const commandColor = isSelected ? "white" : "white";
  const highlightColor = "yellow";
  const descriptionColor = isSelected ? "white" : DONOR_INACTIVE;
  const descriptionWidth = Math.max(
    1,
    width - COMMAND_MARKER_WIDTH - commandColumnWidth,
  );

  // CC parity: CC's `/` picker has NO leading marker column — each row is
  // the command name flush-left, with the selected row shown via color /
  // bold only. Mirror that: drop the marker Box entirely.
  return (
    <Box width={width}>
      <Box width={commandColumnWidth}>
        <HighlightedText
          text={spec.label}
          matchIndices={spec.matchIndices}
          baseColor={commandColor}
          highlightColor={highlightColor}
          bold={isSelected}
        />
      </Box>
      <Box width={descriptionWidth}>
        <Text color={descriptionColor} dimColor={!isSelected}>
          {spec.description ? truncate(spec.description, descriptionWidth) : ""}
        </Text>
      </Box>
    </Box>
  );
}

export function CompletionDropdown({
  items,
  selectedIndex,
  helpText,
  isLoading,
  providerId,
  marginLeft = 0,
  width,
  showDocPanel = false,
}: Props): React.ReactElement | null {
  const isCommandMenu = providerId === "command";

  if (items.length === 0 && !isLoading) {
    return null;
  }

  const scrollWindow = useMemo(
    () => calculateScrollWindow(selectedIndex, items.length, MAX_VISIBLE_ITEMS),
    [selectedIndex, items.length],
  );
  const hasMoreAbove = scrollWindow.start > 0;
  const hasMoreBelow = scrollWindow.end < items.length;
  const visibleItems = items.slice(scrollWindow.start, scrollWindow.end);
  const paddingCount = Math.max(0, MAX_VISIBLE_ITEMS - visibleItems.length);
  const selectedItem = selectedIndex >= 0 && selectedIndex < items.length
    ? items[selectedIndex]
    : null;
  const selectedSpec = selectedItem?.getRenderSpec();
  const previewLines = useMemo(() => {
    if (isCommandMenu) return [];
    const lines: string[] = [];
    if (selectedSpec?.description) {
      lines.push(selectedSpec.description);
    }
    if (selectedSpec?.extendedDoc) {
      lines.push(
        ...selectedSpec.extendedDoc.split("\n").filter(Boolean).slice(
          0,
          showDocPanel ? 2 : 1,
        ),
      );
    }
    return lines.slice(0, showDocPanel ? 3 : 2);
  }, [isCommandMenu, selectedSpec, showDocPanel]);

  const panelWidth = useMemo(() => {
    if (isCommandMenu) {
      return Math.max(1, width ?? COMPLETION_PANEL_MAX_WIDTH);
    }
    const rowWidths = items.map((item) => {
      const spec = item.getRenderSpec();
      const fittedLabelWidth = spec.truncate === "none"
        ? spec.label.length
        : Math.min(spec.label.length, spec.maxWidth);
      return SELECTOR_COLUMN_WIDTH + 1 + fittedLabelWidth +
        (spec.typeLabel ? META_COLUMN_WIDTH : 0);
    });
    return measureCompletionPanelWidth({
      rowWidths,
      helpText: items.length > 0 ? helpText : undefined,
      previewLines,
      maxWidth: width,
    });
  }, [helpText, isCommandMenu, items, previewLines, width]);

  const commandColumnWidth = useMemo(() => {
    const commandWidths = visibleItems.map((item) => item.getRenderSpec().label.length);
    const maxWidth = commandWidths.length > 0 ? Math.max(...commandWidths) : 0;
    return Math.max(
      COMMAND_MIN_LABEL_WIDTH,
      Math.min(COMMAND_MAX_LABEL_WIDTH, maxWidth + 1),
    );
  }, [visibleItems]);

  return (
    // CC parity: CC's autocomplete dropdown is inline (no box border), flush
    // to the prompt column with no top margin gap. Removing `borderStyle` +
    // padding + top margin here matches CC's `useTypeahead` rendering layout
    // (~/dev/ClaudeCode-main/hooks/useTypeahead.tsx + the inline row rendering
    // in CC's PromptInput.tsx).
    <Box marginLeft={marginLeft} flexDirection="column" width={Math.max(COMPLETION_PANEL_MIN_WIDTH, panelWidth)}>
      <Box flexDirection="column">
        {isLoading && items.length === 0
          ? <Text color={DONOR_INACTIVE}>Loading…</Text>
          : (
            <>
              {hasMoreAbove && <Text color={DONOR_INACTIVE}>↑</Text>}
              {visibleItems.map((item, visibleIndex) => {
                const absoluteIndex = scrollWindow.start + visibleIndex;
                if (isCommandMenu) {
                  return (
                    <React.Fragment key={item.id}>
                      <CommandItemRow
                        item={item}
                        isSelected={absoluteIndex === selectedIndex}
                        commandColumnWidth={commandColumnWidth}
                        width={Math.max(1, panelWidth - 2)}
                      />
                    </React.Fragment>
                  );
                }
                const spec = item.getRenderSpec();
                return (
                  <React.Fragment key={item.id}>
                    <PickerRow
                      // CC parity: CC's `@` picker uses `+ ` as an "addable
                      // mention" prefix on EVERY row, and conveys selection
                      // via color/bold, not a different marker character.
                      // Mirror that here (~/dev/ClaudeCode-main/ @ picker).
                      label={spec.label}
                      matchIndices={spec.matchIndices}
                      pickerColors={PICKER_COLORS}
                      isSelected={absoluteIndex === selectedIndex}
                      width={Math.max(1, panelWidth - 2)}
                      markerText={"+"}
                      markerWidth={SELECTOR_COLUMN_WIDTH}
                      metaText={spec.typeLabel}
                      metaWidth={META_COLUMN_WIDTH}
                      maxLabelWidth={spec.maxWidth}
                      truncate={spec.truncate}
                    />
                  </React.Fragment>
                );
              })}
              {Array.from({ length: paddingCount }, (_, index) => (
                <Text key={`padding-${index}`}> </Text>
              ))}
              {hasMoreBelow && <Text color={DONOR_INACTIVE}>↓</Text>}
            </>
          )}
      </Box>
      {previewLines.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          {previewLines.map((line, index) => (
            <Text key={`preview-${index}`} color={DONOR_INACTIVE} wrap="wrap">
              {line}
            </Text>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={DONOR_INACTIVE} wrap="wrap">
          {helpText}
        </Text>
      </Box>
    </Box>
  );
}
