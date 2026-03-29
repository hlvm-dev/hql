import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../theme/index.ts";
import { buildFieldDisplayState } from "../utils/field-display.ts";

interface ListSearchFieldProps {
  query: string;
  cursor: number;
  width: number;
  placeholder?: string;
}

export function ListSearchField({
  query,
  cursor,
  width,
  placeholder = "Filter models",
}: ListSearchFieldProps): React.ReactElement {
  const sc = useSemanticColors();
  const contentWidth = Math.max(8, width - 4);
  const display = buildFieldDisplayState(
    query,
    cursor,
    contentWidth,
    placeholder,
  );
  const borderColor = query.length === 0
    ? sc.surface.field.border
    : sc.surface.field.borderActive;

  return (
    <Box
      borderStyle="single"
      borderColor={borderColor}
      backgroundColor={sc.surface.field.background}
      paddingX={1}
      width={width}
    >
      {display.isPlaceholder
        ? (
          <>
            <Text
              inverse
              backgroundColor={sc.surface.field.background}
              color={sc.surface.field.cursor}
            >
              {display.cursorChar}
            </Text>
            <Text
              color={sc.surface.field.placeholder}
              backgroundColor={sc.surface.field.background}
              wrap="truncate-end"
            >
              {display.placeholderText}
            </Text>
          </>
        )
        : (
          <>
            <Text
              color={sc.surface.field.text}
              backgroundColor={sc.surface.field.background}
            >
              {display.beforeCursor}
            </Text>
            <Text
              inverse
              backgroundColor={sc.surface.field.background}
              color={sc.surface.field.cursor}
            >
              {display.cursorChar}
            </Text>
            <Text
              color={sc.surface.field.text}
              backgroundColor={sc.surface.field.background}
            >
              {display.afterCursor}
            </Text>
          </>
        )}
    </Box>
  );
}
