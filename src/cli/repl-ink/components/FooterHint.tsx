/**
 * Footer Hint Component
 *
 * Persistent hint showing available shortcuts below input line.
 * Helps users discover keyboard shortcuts.
 */

import React from "npm:react@18";
import { Text, Box } from "npm:ink@5";

export function FooterHint(): React.ReactElement {
  return (
    <Box marginLeft={5}>
      <Text dimColor>
        Ctrl+P commands | Tab complete | Ctrl+R history | Ctrl+L clear
      </Text>
    </Box>
  );
}
