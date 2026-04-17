import type { ReactNode } from "react";
import type { AnyAttachment } from "../../cli/repl/attachment.ts";
import type { Key } from "../ink/events/input-event.ts";
import type { Color } from "../ink/styles.ts";

export type PromptInputMode = "prompt" | "bash";

export type InlineGhostText = {
  readonly text: string;
  readonly fullCommand: string;
  readonly insertPosition: number;
};

export type QueuedCommand = {
  id: string;
  mode: PromptInputMode | "task-notification";
  value: string;
  createdAt: number;
  attachments?: AnyAttachment[];
  cursorOffset?: number;
};

export type TextHighlight = {
  start: number;
  end: number;
  color: Color | undefined;
  dimColor?: boolean;
  inverse?: boolean;
  shimmerColor?: Color;
  priority: number;
};

export type BaseTextInputProps = {
  readonly onHistoryUp?: () => void;
  readonly onHistoryDown?: () => void;
  readonly placeholder?: string;
  readonly multiline?: boolean;
  readonly focus?: boolean;
  readonly mask?: string;
  readonly showCursor?: boolean;
  readonly highlightPastedText?: boolean;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit?: (value: string) => void;
  readonly onExit?: () => void;
  readonly onExitMessage?: (show: boolean, key?: string) => void;
  readonly onHistoryReset?: () => void;
  readonly onClearInput?: () => void;
  readonly columns: number;
  readonly maxVisibleLines?: number;
  readonly onImagePaste?: (
    base64Image: string,
    mediaType?: string,
    filename?: string,
    dimensions?: { width: number; height: number },
    sourcePath?: string,
  ) => void;
  readonly onPaste?: (text: string) => void;
  readonly onIsPastingChange?: (isPasting: boolean) => void;
  readonly disableCursorMovementForUpDownKeys?: boolean;
  readonly disableEscapeDoublePress?: boolean;
  readonly cursorOffset: number;
  onChangeCursorOffset: (offset: number) => void;
  readonly argumentHint?: string;
  readonly onUndo?: () => void;
  readonly dimColor?: boolean;
  readonly highlights?: TextHighlight[];
  readonly placeholderElement?: ReactNode;
  readonly inlineGhostText?: InlineGhostText;
  readonly inputFilter?: (input: string, key: Key) => string;
};

export type BaseInputState = {
  onInput: (input: string, key: Key) => void;
  renderedValue: string;
  offset: number;
  setOffset: (offset: number) => void;
  cursorLine: number;
  cursorColumn: number;
  viewportCharOffset: number;
  viewportCharEnd: number;
  isPasting?: boolean;
  pasteState?: {
    chunks: string[];
    timeoutId: ReturnType<typeof setTimeout> | null;
  };
};

export type TextInputState = BaseInputState;
