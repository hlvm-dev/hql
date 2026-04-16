import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import { stringWidth } from "../ink/stringWidth.ts";
import type { Key } from "../ink/events/input-event.ts";
import { BaseTextInput } from "./BaseTextInput.tsx";
import type { BaseInputState } from "../types/textInputTypes.ts";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function lineMetrics(value: string, cursorOffset: number) {
  const beforeCursor = value.slice(0, cursorOffset);
  const lines = beforeCursor.split("\n");
  const cursorLine = lines.length - 1;
  const cursorColumn = stringWidth(lines.at(-1) ?? "");
  return { cursorLine, cursorColumn };
}

export function BaseTextInputDemo(): React.ReactNode {
  const [value, setValue] = React.useState("");
  const [cursorOffset, setCursorOffset] = React.useState(0);
  const [submitted, setSubmitted] = React.useState<string[]>([]);

  const inputState = React.useMemo<BaseInputState>(() => {
    const { cursorLine, cursorColumn } = lineMetrics(value, cursorOffset);

    const onInput = (input: string, key: Key) => {
      if (key.leftArrow) {
        setCursorOffset((current) => clamp(current - 1, 0, value.length));
        return;
      }

      if (key.rightArrow) {
        setCursorOffset((current) => clamp(current + 1, 0, value.length));
        return;
      }

      if (key.home) {
        setCursorOffset(0);
        return;
      }

      if (key.end) {
        setCursorOffset(value.length);
        return;
      }

      if (key.backspace) {
        if (cursorOffset === 0) return;
        const next = value.slice(0, cursorOffset - 1) + value.slice(cursorOffset);
        setValue(next);
        setCursorOffset(cursorOffset - 1);
        return;
      }

      if (key.delete) {
        if (cursorOffset >= value.length) return;
        const next = value.slice(0, cursorOffset) + value.slice(cursorOffset + 1);
        setValue(next);
        return;
      }

      if (key.return) {
        if (value.trim().length === 0) return;
        setSubmitted((current) => [...current, value]);
        setValue("");
        setCursorOffset(0);
        return;
      }

      if (input.length > 0 && !key.ctrl && !key.meta && !key.super) {
        const next = value.slice(0, cursorOffset) + input + value.slice(cursorOffset);
        setValue(next);
        setCursorOffset(cursorOffset + input.length);
      }
    };

    return {
      onInput,
      renderedValue: value,
      offset: cursorOffset,
      setOffset: setCursorOffset,
      cursorLine,
      cursorColumn,
      viewportCharOffset: 0,
      viewportCharEnd: value.length,
    };
  }, [cursorOffset, value]);

  return (
    <Box flexDirection="column">
      <Text bold>BaseTextInput donor slice</Text>
      <Text dim>
        Type into the donor input. Enter stores a demo submit, arrows move the caret.
      </Text>
      <Box borderStyle="round" flexDirection="column" paddingX={1} marginTop={1}>
        <BaseTextInput
          inputState={inputState}
          terminalFocus={true}
          focus={true}
          showCursor={true}
          value={value}
          onChange={setValue}
          columns={72}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          placeholder="PromptInput donor cluster will sit on top of this"
        />
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text dim>Submitted demo values</Text>
        {submitted.length === 0
          ? <Text dim>(none yet)</Text>
          : submitted.map((entry, index) => (
            <Text key={index}>- {entry}</Text>
          ))}
      </Box>
    </Box>
  );
}
