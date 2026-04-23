import { stringWidth } from "../ink/stringWidth.ts";
import { wrapAnsi } from "../ink/wrapAnsi.ts";
import { RuntimeError } from "../../../common/error.ts";
import { getGraphemeSegmenter } from "../stubs/intl.ts";

type WrappedLine = {
  text: string;
  startOffset: number;
  isPrecededByNewline: boolean;
  endsWithNewline: boolean;
};

export type InputViewportState = {
  renderedValue: string;
  cursorLine: number;
  cursorColumn: number;
  viewportCharOffset: number;
  viewportCharEnd: number;
};

type Position = {
  line: number;
  column: number;
};

function prevOffset(text: string, offset: number): number {
  if (offset <= 0) return 0;

  let previous = 0;
  for (const { index } of getGraphemeSegmenter().segment(text)) {
    if (index >= offset) {
      break;
    }
    previous = index;
  }

  return previous;
}

function nextOffset(text: string, offset: number): number {
  if (offset >= text.length) return text.length;

  for (const { index } of getGraphemeSegmenter().segment(text)) {
    if (index > offset) {
      return index;
    }
  }

  return text.length;
}

function stringIndexToDisplayWidth(text: string, index: number): number {
  if (index <= 0) return 0;
  if (index >= text.length) return stringWidth(text);
  return stringWidth(text.slice(0, index));
}

function displayWidthToStringIndex(text: string, targetWidth: number): number {
  if (targetWidth <= 0 || text.length === 0) return 0;

  let currentWidth = 0;
  let currentOffset = 0;

  for (const { segment, index } of getGraphemeSegmenter().segment(text)) {
    const segmentWidth = stringWidth(segment);
    if (currentWidth + segmentWidth > targetWidth) {
      break;
    }
    currentWidth += segmentWidth;
    currentOffset = index + segment.length;
  }

  return currentOffset;
}

function measureWrappedLines(text: string, columns: number): WrappedLine[] {
  const wrappedText = wrapAnsi(text, Math.max(1, columns), {
    hard: true,
    trim: false,
  });

  const wrappedLines: WrappedLine[] = [];
  let searchOffset = 0;
  let lastNewlinePos = -1;

  const lines = wrappedText.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? "";
    const isPrecededByNewline = (startOffset: number) =>
      lineIndex === 0 ||
      (startOffset > 0 && text[startOffset - 1] === "\n");

    if (line.length === 0) {
      lastNewlinePos = text.indexOf("\n", lastNewlinePos + 1);
      if (lastNewlinePos !== -1) {
        wrappedLines.push({
          text: line,
          startOffset: lastNewlinePos,
          isPrecededByNewline: isPrecededByNewline(lastNewlinePos),
          endsWithNewline: true,
        });
      } else {
        wrappedLines.push({
          text: line,
          startOffset: text.length,
          isPrecededByNewline: isPrecededByNewline(text.length),
          endsWithNewline: false,
        });
      }
      continue;
    }

    const startOffset = text.indexOf(line, searchOffset);
    if (startOffset === -1) {
      throw new RuntimeError("Failed to map wrapped prompt line to source input");
    }

    searchOffset = startOffset + line.length;
    const potentialNewlinePos = startOffset + line.length;
    const endsWithNewline =
      potentialNewlinePos < text.length && text[potentialNewlinePos] === "\n";

    if (endsWithNewline) {
      lastNewlinePos = potentialNewlinePos;
    }

    wrappedLines.push({
      text: line,
      startOffset,
      isPrecededByNewline: isPrecededByNewline(startOffset),
      endsWithNewline,
    });
  }

  return wrappedLines;
}

function getWrappedLine(lines: WrappedLine[], line: number): WrappedLine {
  return lines[Math.max(0, Math.min(line, lines.length - 1))]!;
}

function getPositionFromOffset(
  text: string,
  columns: number,
  offset: number,
): Position {
  const lines = measureWrappedLines(text, columns);

  for (let line = 0; line < lines.length; line++) {
    const currentLine = lines[line]!;
    const nextLine = lines[line + 1];

    if (
      offset >= currentLine.startOffset &&
      (!nextLine || offset < nextLine.startOffset)
    ) {
      const stringPosInLine = offset - currentLine.startOffset;
      let displayColumn: number;

      if (currentLine.isPrecededByNewline) {
        displayColumn = stringIndexToDisplayWidth(currentLine.text, stringPosInLine);
      } else {
        const leadingWhitespace =
          currentLine.text.length - currentLine.text.trimStart().length;

        if (stringPosInLine < leadingWhitespace) {
          displayColumn = 0;
        } else {
          const trimmedText = currentLine.text.trimStart();
          const posInTrimmed = stringPosInLine - leadingWhitespace;
          displayColumn = stringIndexToDisplayWidth(trimmedText, posInTrimmed);
        }
      }

      return { line, column: Math.max(0, displayColumn) };
    }
  }

  const lastIndex = Math.max(0, lines.length - 1);
  const lastLine = lines[lastIndex]!;
  return { line: lastIndex, column: stringWidth(lastLine.text) };
}

function getOffsetFromPosition(
  text: string,
  columns: number,
  position: Position,
): number {
  const lines = measureWrappedLines(text, columns);
  const wrappedLine = getWrappedLine(lines, position.line);

  if (wrappedLine.text.length === 0 && wrappedLine.endsWithNewline) {
    return wrappedLine.startOffset;
  }

  const leadingWhitespace = wrappedLine.isPrecededByNewline
    ? 0
    : wrappedLine.text.length - wrappedLine.text.trimStart().length;

  const displayColumnWithLeading = position.column + leadingWhitespace;
  const stringIndex = displayWidthToStringIndex(
    wrappedLine.text,
    displayColumnWithLeading,
  );

  const offset = wrappedLine.startOffset + stringIndex;
  const lineEnd = wrappedLine.startOffset + wrappedLine.text.length;
  const lineDisplayWidth = stringWidth(wrappedLine.text);
  const maxOffset = wrappedLine.endsWithNewline && position.column > lineDisplayWidth
    ? lineEnd + 1
    : lineEnd;

  return Math.min(offset, maxOffset);
}

export function moveCursorLeft(text: string, offset: number): number {
  return prevOffset(text, offset);
}

export function moveCursorRight(text: string, offset: number): number {
  return nextOffset(text, offset);
}

export function moveCursorUp(
  text: string,
  columns: number,
  offset: number,
): number {
  const position = getPositionFromOffset(text, columns, offset);
  if (position.line === 0) {
    return offset;
  }

  const lines = measureWrappedLines(text, columns);
  const previousLine = lines[position.line - 1];
  if (!previousLine) {
    return offset;
  }

  return getOffsetFromPosition(text, columns, {
    line: position.line - 1,
    column: Math.min(position.column, stringWidth(previousLine.text)),
  });
}

export function moveCursorDown(
  text: string,
  columns: number,
  offset: number,
): number {
  const position = getPositionFromOffset(text, columns, offset);
  const lines = measureWrappedLines(text, columns);
  const nextLine = lines[position.line + 1];
  if (!nextLine) {
    return offset;
  }

  return getOffsetFromPosition(text, columns, {
    line: position.line + 1,
    column: Math.min(position.column, stringWidth(nextLine.text)),
  });
}

export function moveCursorToStartOfLine(
  text: string,
  columns: number,
  offset: number,
): number {
  const position = getPositionFromOffset(text, columns, offset);
  return getOffsetFromPosition(text, columns, {
    line: position.line,
    column: 0,
  });
}

export function moveCursorToEndOfLine(
  text: string,
  columns: number,
  offset: number,
): number {
  const position = getPositionFromOffset(text, columns, offset);
  const lines = measureWrappedLines(text, columns);
  const current = getWrappedLine(lines, position.line);

  return getOffsetFromPosition(text, columns, {
    line: position.line,
    column: stringWidth(current.text),
  });
}

export function getInputViewportState(
  text: string,
  columns: number,
  cursorOffset: number,
  maxVisibleLines?: number,
): InputViewportState {
  const normalizedColumns = Math.max(1, columns);
  const position = getPositionFromOffset(text, normalizedColumns, cursorOffset);
  const lines = measureWrappedLines(text, normalizedColumns);

  let startLine = 0;
  if (maxVisibleLines && maxVisibleLines > 0 && lines.length > maxVisibleLines) {
    const half = Math.floor(maxVisibleLines / 2);
    startLine = Math.max(0, position.line - half);
    const endLine = Math.min(lines.length, startLine + maxVisibleLines);
    if (endLine - startLine < maxVisibleLines) {
      startLine = Math.max(0, endLine - maxVisibleLines);
    }
  }

  const endLine = maxVisibleLines && maxVisibleLines > 0
    ? Math.min(lines.length, startLine + maxVisibleLines)
    : lines.length;

  const renderedLines = lines.slice(startLine, endLine).map((line) =>
    line.isPrecededByNewline ? line.text : line.text.trimStart()
  );

  const viewportCharOffset = lines[startLine]?.startOffset ?? 0;
  const viewportCharEnd = endLine >= lines.length
    ? text.length
    : (lines[endLine]?.startOffset ?? text.length);

  return {
    renderedValue: renderedLines.join("\n"),
    cursorLine: position.line - startLine,
    cursorColumn: position.column,
    viewportCharOffset,
    viewportCharEnd,
  };
}
