import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import useInput from "../ink/hooks/use-input.ts";
import { useAppState } from "../state/context.tsx";
import { useAppDispatch } from "../state/context.tsx";

interface ChatInputProps {
  onSubmit: (text: string) => void;
  isLoading: boolean;
}

function ChatInput({ onSubmit, isLoading }: ChatInputProps) {
  const { inputMode, inputText } = useAppState();
  const dispatch = useAppDispatch();

  useInput(
    (input, key) => {
      if (isLoading) return;

      // Shift+Tab: toggle mode (escape sequence \x1b[Z or key combo)
      if (input === "\x1b[Z" || (key.tab && key.shift)) {
        dispatch({ type: "toggle_mode" });
        return;
      }

      // Enter: submit non-empty text
      if (key.return) {
        if (inputText.length > 0) {
          onSubmit(inputText);
          dispatch({ type: "set_input", text: "", cursor: 0 });
        }
        return;
      }

      // Backspace: remove last character
      if (key.backspace || key.delete) {
        if (inputText.length > 0) {
          const next = inputText.slice(0, -1);
          dispatch({ type: "set_input", text: next, cursor: next.length });
        }
        return;
      }

      // Skip non-printable / modifier-only keys
      if (
        key.tab ||
        key.escape ||
        key.upArrow ||
        key.downArrow ||
        key.leftArrow ||
        key.rightArrow ||
        key.ctrl ||
        key.meta
      ) {
        return;
      }

      // Regular character input
      if (input) {
        const next = inputText + input;
        dispatch({ type: "set_input", text: next, cursor: next.length });
      }
    },
  );

  const prompt =
    inputMode === "code" ? (
      <Text color="yellow">{"λ❯ "}</Text>
    ) : (
      <Text color="green">{"❯ "}</Text>
    );

  return (
    <Box borderStyle="round" paddingX={1}>
      {prompt}
      {isLoading ? (
        <Text dimColor>Thinking...</Text>
      ) : (
        <Text>
          {inputText}
          <Text inverse>{" "}</Text>
        </Text>
      )}
    </Box>
  );
}

export default ChatInput;
