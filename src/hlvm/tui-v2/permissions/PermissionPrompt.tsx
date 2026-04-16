import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import useInput from "../ink/hooks/use-input.ts";

interface PermissionPromptProps {
  toolName: string;
  description: string;
  onAllow: () => void;
  onDeny: () => void;
}

const PermissionPrompt = ({
  toolName,
  description,
  onAllow,
  onDeny,
}: PermissionPromptProps) => {
  useInput((input, key) => {
    if (input.toLowerCase() === "y") {
      onAllow();
    } else if (input.toLowerCase() === "n" || (key.ctrl && input === "c")) {
      onDeny();
    }
  });

  return (
    <Box
      borderStyle="round"
      borderColor="yellow"
      flexDirection="column"
      paddingX={1}
    >
      <Text bold color="yellow">⚡ {toolName}</Text>
      <Text>  {description}</Text>
      <Text> </Text>
      <Text dimColor>  y to allow · n to deny · Ctrl+C</Text>
    </Box>
  );
};

export default PermissionPrompt;
