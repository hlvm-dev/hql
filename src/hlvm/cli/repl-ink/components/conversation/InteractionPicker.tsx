import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import type { ChromeChipTone } from "../ChromeChip.tsx";
import { PickerRow } from "../PickerRow.tsx";
import { TRANSCRIPT_LAYOUT } from "../../utils/layout-tokens.ts";
import { getPickerColors } from "../../utils/picker-theme.ts";

export interface InteractionPickerOption {
  label: string;
  value: string;
  detail?: string;
  recommended?: boolean;
}

const APPLICATION_KEYPAD_DIGIT_MAP = new Map<string, string>([
  ["Op", "0"],
  ["Oq", "1"],
  ["Or", "2"],
  ["Os", "3"],
  ["Ot", "4"],
  ["Ou", "5"],
  ["Ov", "6"],
  ["Ow", "7"],
  ["Ox", "8"],
  ["Oy", "9"],
]);

function normalizePickerDigitInput(input: string): string {
  const normalizedInput = input.startsWith("\x1b") ? input.slice(1) : input;
  return APPLICATION_KEYPAD_DIGIT_MAP.get(normalizedInput) ?? normalizedInput;
}

export function resolvePickerDigitSelection(
  input: string,
  optionCount: number,
): number | undefined {
  const normalizedInput = normalizePickerDigitInput(input);
  if (!/^[1-9]$/.test(normalizedInput)) return undefined;
  const index = Number(normalizedInput) - 1;
  return index >= 0 && index < optionCount ? index : undefined;
}

interface InteractionPickerProps {
  title: string;
  subtitle?: string;
  options: InteractionPickerOption[];
  hint: string;
  hintContent?: React.ReactNode;
  tone?: ChromeChipTone;
  onSubmit: (option: InteractionPickerOption, notes?: string) => void;
  onCancel: () => void;
  allowNotes?: boolean;
  notesLabel?: string;
  notesPlaceholder?: string;
  notesEmptyText?: string;
  children?: React.ReactNode;
}

function getInitialSelection(options: InteractionPickerOption[]): number {
  const recommendedIndex = options.findIndex((option) => option.recommended);
  return recommendedIndex >= 0 ? recommendedIndex : 0;
}

function optionNeedsNotes(
  option: InteractionPickerOption | undefined,
): boolean {
  if (!option) return false;
  return /\b(other|something else|describe)\b/i.test(
    `${option.label} ${option.value}`,
  );
}

function removeLastCharacter(value: string): string {
  const chars = Array.from(value);
  chars.pop();
  return chars.join("");
}

export const InteractionPicker = React.memo(function InteractionPicker(
  {
    title,
    subtitle,
    options,
    hint,
    hintContent,
    tone = "active",
    onSubmit,
    onCancel,
    allowNotes = false,
    notesLabel = "Notes",
    notesPlaceholder = "Type details here...",
    notesEmptyText = "Press Tab to add details.",
    children,
  }: InteractionPickerProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const pickerColors = getPickerColors(sc, tone);
  const optionsSignature = useMemo(
    () =>
      options.map((option) =>
        `${option.value}:${option.label}:${option.detail ?? ""}:${
          option.recommended ? "1" : "0"
        }`
      ).join("|"),
    [options],
  );
  const [selectedIndex, setSelectedIndex] = useState(() =>
    getInitialSelection(options)
  );
  const [notesMode, setNotesMode] = useState(false);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    setSelectedIndex(getInitialSelection(options));
    setNotesMode(false);
    setNotes("");
  }, [optionsSignature]);

  const selectedOption = useMemo(
    () => options[selectedIndex] ?? options[0],
    [options, selectedIndex],
  );
  const trimmedNotes = notes.trim();
  const displayedHint = notesMode
    ? "Type notes · Tab choices · Enter · Esc"
    : hint;

  useInput((input, key) => {
    if (options.length === 0) return;
    if (key.escape) {
      onCancel();
      return;
    }
    if (allowNotes && key.tab) {
      setNotesMode((current: boolean) => !current);
      return;
    }
    if (notesMode) {
      if (key.return) {
        if (selectedOption) {
          onSubmit(selectedOption, trimmedNotes);
        }
        return;
      }
      if (key.backspace || key.delete) {
        setNotes((current: string) => removeLastCharacter(current));
        return;
      }
      if (
        !key.ctrl && !key.meta && input.length > 0 && input !== "\r" &&
        input !== "\n"
      ) {
        setNotes((current: string) => current + input);
      }
      return;
    }
    const digitSelection = resolvePickerDigitSelection(input, options.length);
    if (digitSelection !== undefined) {
      setSelectedIndex(digitSelection);
      return;
    }
    if (key.upArrow || key.leftArrow || input === "k" || input === "h") {
      setSelectedIndex((current: number) =>
        (current - 1 + options.length) % options.length
      );
      return;
    }
    if (key.downArrow || key.rightArrow || input === "j" || input === "l") {
      setSelectedIndex((current: number) => (current + 1) % options.length);
      return;
    }
    if (key.return) {
      if (selectedOption) {
        if (
          allowNotes && optionNeedsNotes(selectedOption) &&
          trimmedNotes.length === 0
        ) {
          setNotesMode(true);
          return;
        }
        onSubmit(selectedOption, trimmedNotes);
      }
      return;
    }
  });

  return (
    <Box flexDirection="column" marginBottom={0}>
      {title.trim().length > 0 && (
        <Box>
          <Text color={pickerColors.titleColor} bold>{title}</Text>
        </Box>
      )}
      {subtitle && (
        <Box marginTop={1}>
          <Text color={sc.text.secondary} wrap="wrap">
            {subtitle}
          </Text>
        </Box>
      )}
      {children && (
        <Box marginTop={1} flexDirection="column">
          {children}
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        {options.map((option, index) => {
          const isSelected = index === selectedIndex;
          const optionBackground = isSelected
            ? pickerColors.selectedBackground
            : undefined;
          const markerText = `${isSelected ? ">" : " "} ${index + 1}.`;
          return (
            <Box
              key={`${option.value}-${index}`}
              flexDirection="column"
            >
              <Box>
                <PickerRow
                  label={option.label}
                  pickerColors={pickerColors}
                  isSelected={isSelected}
                  markerText={markerText}
                  markerWidth={markerText.length}
                  suffixText={option.recommended ? " (Recommended)" : undefined}
                  suffixColor={isSelected
                    ? pickerColors.selectedMeta
                    : sc.status.success}
                  labelBold
                />
              </Box>
              {option.detail && (
                <Box
                  paddingLeft={TRANSCRIPT_LAYOUT.pickerDetailIndent}
                  marginBottom={index < options.length - 1 ? 1 : 0}
                >
                  <Text color={pickerColors.previewColor} wrap="wrap">
                    {option.detail}
                  </Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
      {allowNotes && (notesMode || notes.length > 0) && (
        <Box marginTop={1} marginBottom={1} flexDirection="column">
          <Text color={pickerColors.previewColor}>{notesLabel}</Text>
          <Text
            color={notesMode
              ? pickerColors.rowForeground
              : pickerColors.emptyColor}
          >
            {notes.length > 0
              ? notes
              : notesMode
              ? notesPlaceholder
              : notesEmptyText}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        {hintContent
          ? hintContent
          : (
            <Text color={pickerColors.hintColor}>
              {displayedHint}
            </Text>
          )}
      </Box>
    </Box>
  );
});
