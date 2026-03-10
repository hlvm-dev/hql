/**
 * QuestionDialog Component
 *
 * Displays an agent question dialog for user text input.
 * Submit on Enter.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { QUESTION_DIALOG_HINT } from "./interaction-dialog-layout.ts";

interface QuestionDialogProps {
  question?: string;
}

export function QuestionDialog({ question }: QuestionDialogProps): React.ReactElement {
  const sc = useSemanticColors();

  return (
    <Box
      borderStyle="round"
      borderColor={sc.status.warning}
      paddingX={1}
      paddingY={0}
      flexDirection="column"
    >
      <Box>
        <Text color={sc.status.warning} bold>
          {"? Agent question"}
        </Text>
      </Box>
      {question && (
        <Box marginTop={0}>
          <Text color={sc.text.primary} wrap="wrap">
            {question}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={sc.text.muted}>
          {QUESTION_DIALOG_HINT}
        </Text>
      </Box>
    </Box>
  );
}
