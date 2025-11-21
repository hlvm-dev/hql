/**
 * Utilities for cursor navigation and word-based editing inside the REPL.
 * Extracted so we can unit test edge cases without needing a real TTY.
 */

const WORD_CHARS = /[0-9A-Za-z_$?!]/;
const WHITESPACE = /\s/;

type CharClassifier = (char: string) => boolean;

const isWhitespace: CharClassifier = (char) => WHITESPACE.test(char);
const isWordChar: CharClassifier = (char) => WORD_CHARS.test(char);

function getChar(line: string, index: number): string {
  return line[index] ?? "";
}

function rewindWhile(
  line: string,
  start: number,
  predicate: CharClassifier,
): number {
  let pos = start;
  while (pos > 0 && predicate(getChar(line, pos - 1))) {
    pos -= 1;
  }
  return pos;
}

function advanceWhile(
  line: string,
  start: number,
  predicate: CharClassifier,
): number {
  let pos = start;
  while (pos < line.length && predicate(getChar(line, pos))) {
    pos += 1;
  }
  return pos;
}

function rewindNonWhitespace(line: string, start: number): number {
  if (start <= 0) return 0;
  let pos = rewindWhile(line, start, isWhitespace);
  if (pos <= 0) return 0;

  const previous = getChar(line, pos - 1);
  const predicate = isWordChar(previous) ? isWordChar : (char: string) =>
    !isWhitespace(char) && !isWordChar(char);
  return rewindWhile(line, pos, predicate);
}

function advanceNonWhitespace(line: string, start: number): number {
  if (start >= line.length) return line.length;
  let pos = advanceWhile(line, start, isWhitespace);
  if (pos >= line.length) return line.length;

  const current = getChar(line, pos);
  const predicate = isWordChar(current) ? isWordChar : (char: string) =>
    !isWhitespace(char) && !isWordChar(char);
  return advanceWhile(line, pos, predicate);
}

export function findWordBoundaryLeft(line: string, cursor: number): number {
  return rewindNonWhitespace(line, cursor);
}

export function findWordBoundaryRight(line: string, cursor: number): number {
  return advanceNonWhitespace(line, cursor);
}

export function deleteWordLeft(
  line: string,
  cursor: number,
): { line: string; cursor: number } {
  const target = findWordBoundaryLeft(line, cursor);
  return {
    line: line.slice(0, target) + line.slice(cursor),
    cursor: target,
  };
}

export function deleteWordRight(
  line: string,
  cursor: number,
): { line: string; cursor: number } {
  const target = findWordBoundaryRight(line, cursor);
  return {
    line: line.slice(0, cursor) + line.slice(target),
    cursor,
  };
}
