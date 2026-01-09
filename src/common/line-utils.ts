/**
 * Line Utilities - Shared line splitting and counting functions
 *
 * Handles all newline formats: \n (Unix), \r\n (Windows), \r (old Mac)
 */

/**
 * Pre-compiled regex for splitting text into lines.
 * Handles all newline formats: \n, \r\n, and \r
 */
export const LINE_SPLIT_REGEX = /\r?\n|\r/;

/**
 * Count the number of lines in text.
 */
export function countLines(text: string): number {
  return text.split(LINE_SPLIT_REGEX).length;
}
