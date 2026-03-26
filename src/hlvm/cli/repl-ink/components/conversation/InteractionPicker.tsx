import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import type { ChromeChipTone } from "../ChromeChip.tsx";

export interface InteractionPickerOption {
  label: string;
  value: string;
  detail?: string;
  recommended?: boolean;
}

export function resolvePickerDigitSelection(
  input: string,
  optionCount: number,
): number | undefined {
  if (!/^[1-9]$/.test(input)) return undefined;
  const index = Number(input) - 1;
  return index >= 0 && index < optionCount ? index : undefined;
}

interface InteractionPickerProps {
  title: string;
  subtitle?: string;
  options: InteractionPickerOption[];
  hint: string;
  tone?: ChromeChipTone;
  onSubmit: (option: InteractionPickerOption, notes?: string) => void;
  onCancel: () => void;
  allowNotes?: boolean;
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
    tone = "active",
    onSubmit,
    onCancel,
    allowNotes = false,
    children,
  }: InteractionPickerProps,
): React.ReactElement {
  const sc = useSemanticColors();
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
    ? "Type notes · Tab return to choices · Enter submit · Esc cancel"
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
    <Box
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
      paddingY={0}
      flexDirection="column"
      marginBottom={0}
    >
      <Box>
        <Text color={titleColor} bold>{title}</Text>
      </Box>
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
          return (
            <Box
              key={`${option.value}-${index}`}
              flexDirection="column"
            >
              <Box>
                <Text
                  color={isSelected ? titleColor : sc.text.muted}
                  bold
                >
                  {isSelected ? "●" : " "} {index + 1}.
                </Text>
                <Text
                  color={isSelected ? titleColor : sc.text.primary}
                  bold
                >
                  {" "}
                  {option.label}
                </Text>
                {option.recommended && (
                  <>
                    <Text color={sc.text.secondary}>{" "}</Text>
                    <Text color={sc.status.success}>Recommended</Text>
                  </>
                )}
              </Box>
              {option.detail && (
                <Box
                  paddingLeft={5}
                  marginBottom={index < options.length - 1 ? 1 : 0}
                >
                  <Text color={sc.text.secondary} wrap="wrap">
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
          <Text color={sc.text.secondary}>Notes</Text>
          <Text color={notesMode ? sc.text.primary : sc.text.muted}>
            {notes.length > 0
              ? notes
              : notesMode
              ? "Type details here..."
              : "Press Tab to add details."}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={sc.text.muted}>
          {displayedHint}
        </Text>
      </Box>
    </Box>
  );
});
