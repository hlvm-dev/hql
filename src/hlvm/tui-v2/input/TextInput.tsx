import chalk from "chalk";
import React from "react";
import { useTextInput } from "../hooks/useTextInput.ts";
import { useTerminalFocus } from "../ink/hooks/use-terminal-focus.ts";
import { BaseTextInput } from "./BaseTextInput.tsx";
import type {
  BaseTextInputProps,
  TextHighlight,
} from "../types/textInputTypes.ts";

export type Props = BaseTextInputProps & {
  highlights?: TextHighlight[];
};

export default function TextInput(props: Props): React.ReactNode {
  const isTerminalFocused = useTerminalFocus();
  const invert = chalk.inverse;

  const textInputState = useTextInput({
    value: props.value,
    onChange: props.onChange,
    onSubmit: props.onSubmit,
    onExit: props.onExit,
    onExitMessage: props.onExitMessage,
    onHistoryReset: props.onHistoryReset,
    onHistoryUp: props.onHistoryUp,
    onHistoryDown: props.onHistoryDown,
    onClearInput: props.onClearInput,
    focus: props.focus,
    mask: props.mask,
    multiline: props.multiline,
    cursorChar: props.showCursor ? " " : "",
    highlightPastedText: props.highlightPastedText,
    invert,
    themeText: (text: string) => text,
    columns: props.columns,
    maxVisibleLines: props.maxVisibleLines,
    onImagePaste: props.onImagePaste,
    disableCursorMovementForUpDownKeys: props.disableCursorMovementForUpDownKeys,
    disableEscapeDoublePress: props.disableEscapeDoublePress,
    externalOffset: props.cursorOffset,
    onOffsetChange: props.onChangeCursorOffset,
    inputFilter: props.inputFilter,
    inlineGhostText: props.inlineGhostText,
    dim: chalk.dim,
  });

  return (
    <BaseTextInput
      inputState={textInputState}
      terminalFocus={isTerminalFocused}
      highlights={props.highlights}
      invert={invert}
      {...props}
    />
  );
}
