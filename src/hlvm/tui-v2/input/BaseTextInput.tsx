import React from "react";
import { renderPlaceholder } from "../hooks/renderPlaceholder.ts";
import { usePasteHandler } from "../hooks/usePasteHandler.ts";
import { Ansi } from "../ink/Ansi.tsx";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import type { InputEvent } from "../ink/events/input-event.ts";
import { useDeclaredCursor } from "../ink/hooks/use-declared-cursor.ts";
import useInput from "../ink/hooks/use-input.ts";
import type {
  BaseInputState,
  BaseTextInputProps,
  TextHighlight,
} from "../types/textInputTypes.ts";
import { HighlightedInput } from "./ShimmeredInput.tsx";

type BaseTextInputComponentProps = BaseTextInputProps & {
  inputState: BaseInputState;
  children?: React.ReactNode;
  terminalFocus: boolean;
  highlights?: TextHighlight[];
  invert?: (text: string) => string;
  hidePlaceholderText?: boolean;
};

export function BaseTextInput({
  inputState,
  children,
  terminalFocus,
  invert,
  hidePlaceholderText,
  ...props
}: BaseTextInputComponentProps): React.ReactNode {
  const { onInput, renderedValue, cursorLine, cursorColumn } = inputState;

  const cursorRef = useDeclaredCursor({
    line: cursorLine,
    column: cursorColumn,
    active: Boolean(props.focus && props.showCursor && terminalFocus),
  });

  const { wrappedOnInput, isPasting } = usePasteHandler({
    onPaste: props.onPaste,
    onInput: (input, key) => {
      if (isPasting && key.return) {
        return;
      }

      onInput(input, key);
    },
    onImagePaste: props.onImagePaste,
  });

  const { onIsPastingChange } = props;
  React.useEffect(() => {
    if (onIsPastingChange) {
      onIsPastingChange(isPasting);
    }
  }, [isPasting, onIsPastingChange]);

  const { showPlaceholder, renderedPlaceholder } = renderPlaceholder({
    placeholder: props.placeholder,
    value: props.value,
    showCursor: props.showCursor,
    focus: props.focus,
    terminalFocus,
    invert,
    hidePlaceholderText,
  });

  useInput(
    (input, key, event: InputEvent) => wrappedOnInput(input, key, event),
    { isActive: props.focus },
  );

  const commandWithoutArgs =
    (props.value && props.value.trim().indexOf(" ") === -1) ||
    (props.value && props.value.endsWith(" "));
  const showArgumentHint = Boolean(
    props.argumentHint &&
      props.value &&
      commandWithoutArgs &&
      props.value.startsWith("/"),
  );

  const cursorFiltered = props.showCursor && props.highlights
    ? props.highlights.filter((highlight) =>
      highlight.dimColor ||
      props.cursorOffset < highlight.start ||
      props.cursorOffset >= highlight.end
    )
    : props.highlights;

  const { viewportCharOffset, viewportCharEnd } = inputState;
  const filteredHighlights = cursorFiltered && viewportCharOffset > 0
    ? cursorFiltered
      .filter((highlight) =>
        highlight.end > viewportCharOffset &&
        highlight.start < viewportCharEnd
      )
      .map((highlight) => ({
        ...highlight,
        start: Math.max(0, highlight.start - viewportCharOffset),
        end: highlight.end - viewportCharOffset,
      }))
    : cursorFiltered;

  const hasHighlights = Boolean(
    filteredHighlights && filteredHighlights.length > 0,
  );

  if (hasHighlights) {
    return (
      <Box ref={cursorRef}>
        <HighlightedInput
          text={renderedValue}
          highlights={filteredHighlights!}
        />
        {showArgumentHint && (
          <Text dim={true}>
            {props.value?.endsWith(" ") ? "" : " "}
            {props.argumentHint}
          </Text>
        )}
        {children}
      </Box>
    );
  }

  return (
    <Box ref={cursorRef}>
      <Text wrap="truncate-end" dim={props.dimColor}>
        {showPlaceholder && props.placeholderElement
          ? props.placeholderElement
          : showPlaceholder && renderedPlaceholder
          ? <Ansi>{renderedPlaceholder}</Ansi>
          : <Ansi>{renderedValue}</Ansi>}
        {showArgumentHint && (
          <Text dim={true}>
            {props.value?.endsWith(" ") ? "" : " "}
            {props.argumentHint}
          </Text>
        )}
        {children}
      </Text>
    </Box>
  );
}
