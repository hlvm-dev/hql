import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../common/utils.ts";
import { useTheme } from "../../theme/index.ts";
import { buildCursorWindowDisplay } from "../utils/cursor-window.ts";

interface SearchFieldDisplay {
  beforeCursor: string;
  cursorChar: string;
  afterCursor: string;
}

export interface ListSearchFieldProps {
  query: string;
  cursor: number;
  width: number;
  placeholder?: string;
}

/**
 * Keep the cursor visible inside a fixed-width search field.
 */
function buildSearchFieldDisplay(
  value: string,
  cursor: number,
  maxChars: number,
): SearchFieldDisplay {
  const display = buildCursorWindowDisplay(value, cursor, maxChars);
  return {
    beforeCursor: display.beforeCursor,
    cursorChar: display.cursorChar,
    afterCursor: display.afterCursor,
  };
}

export function ListSearchField({
  query,
  cursor,
  width,
  placeholder = "Filter models",
}: ListSearchFieldProps): React.ReactElement {
  const { color } = useTheme();
  const contentWidth = Math.max(8, width - 4);
  const visibleChars = Math.max(1, contentWidth);
  const placeholderWidth = Math.max(1, visibleChars - 1);
  const display = buildSearchFieldDisplay(query, cursor, visibleChars);
  const borderColor = query.length === 0 ? color("muted") : color("accent");

  return (
    <Box
      borderStyle="single"
      borderColor={borderColor}
      paddingX={1}
      width={width}
    >
      {query.length === 0
        ? (
          <>
            <Text backgroundColor="white" color="black">{" "}</Text>
            <Text dimColor wrap="truncate-end">
              {truncate(placeholder, placeholderWidth, "…")}
            </Text>
          </>
        )
        : (
          <>
            <Text>{display.beforeCursor}</Text>
            <Text backgroundColor="white" color="black">
              {display.cursorChar}
            </Text>
            <Text>{display.afterCursor}</Text>
          </>
        )}
    </Box>
  );
}
