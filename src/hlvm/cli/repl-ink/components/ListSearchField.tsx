import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../common/utils.ts";
import { useTheme } from "../../theme/index.ts";
import { buildCursorWindowDisplay } from "../utils/cursor-window.ts";

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
  const { color } = useTheme();
  const contentWidth = Math.max(8, width - 4);
  const visibleChars = Math.max(1, contentWidth);
  const placeholderWidth = Math.max(1, visibleChars - 1);
  const display = buildCursorWindowDisplay(query, cursor, visibleChars);
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
            <Text inverse>{" "}</Text>
            <Text dimColor wrap="truncate-end">
              {truncate(placeholder, placeholderWidth, "…")}
            </Text>
          </>
        )
        : (
          <>
            <Text>{display.beforeCursor}</Text>
            <Text inverse>
              {display.cursorChar}
            </Text>
            <Text>{display.afterCursor}</Text>
          </>
        )}
    </Box>
  );
}
