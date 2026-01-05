// src/transpiler/utils/escape-sequences.ts
// Centralized escape sequence handling - eliminates duplication in parser.ts

/**
 * Standard escape sequence mappings
 * Maps escape character to its actual string value
 */
export const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  "n": "\n",
  "t": "\t",
  "r": "\r",
  "\\": "\\",
  '"': '"',
  "'": "'",
  "0": "\0",
  "b": "\b",
  "f": "\f",
  "v": "\v",
  "`": "`",
  "$": "$",
};

/**
 * Regex for validating hex escape sequences (\xNN)
 */
export const HEX_ESCAPE_REGEX = /^[0-9a-fA-F]{2}$/;

/**
 * Regex for validating unicode escape sequences (\uNNNN)
 */
export const UNICODE_ESCAPE_REGEX = /^[0-9a-fA-F]{4}$/;

/**
 * Regex for validating extended unicode escapes (\u{NNNN...})
 */
export const UNICODE_EXTENDED_REGEX = /^[0-9a-fA-F]+$/;

/**
 * Result of processing an escape sequence
 */
export interface EscapeResult {
  /** The resolved character(s) */
  value: string;
  /** Number of additional characters consumed from input (beyond the escape char itself) */
  consumed: number;
}

/**
 * Process a hex escape sequence (\xNN)
 *
 * @param content - The content string starting after 'x'
 * @returns The resolved character and consumed count, or null if invalid
 */
export function processHexEscape(content: string): EscapeResult | null {
  const hex = content.slice(0, 2);
  if (HEX_ESCAPE_REGEX.test(hex)) {
    return {
      value: String.fromCharCode(parseInt(hex, 16)),
      consumed: 2,
    };
  }
  return null;
}

/**
 * Process a unicode escape sequence (\uNNNN or \u{NNNN...})
 *
 * @param content - The content string starting after 'u'
 * @returns The resolved character and consumed count, or null if invalid
 */
export function processUnicodeEscape(content: string): EscapeResult | null {
  // Extended form: \u{NNNN...}
  if (content[0] === "{") {
    const endBrace = content.indexOf("}");
    if (endBrace !== -1) {
      const hex = content.slice(1, endBrace);
      if (UNICODE_EXTENDED_REGEX.test(hex)) {
        return {
          value: String.fromCodePoint(parseInt(hex, 16)),
          consumed: endBrace + 1,  // Include the closing brace itself
        };
      }
    }
    return null;
  }

  // Standard form: \uNNNN
  const hex = content.slice(0, 4);
  if (UNICODE_ESCAPE_REGEX.test(hex)) {
    return {
      value: String.fromCharCode(parseInt(hex, 16)),
      consumed: 4,
    };
  }
  return null;
}

/**
 * Process a single escape sequence at a given position
 *
 * This is useful for template literals where escape handling is interleaved
 * with interpolation processing.
 *
 * @param escapeChar - The character after the backslash
 * @param content - The remaining content string (after the escape char)
 * @returns The resolved character and consumed count (beyond escapeChar)
 */
export function processSingleEscape(
  escapeChar: string,
  content: string,
): EscapeResult {
  // Check simple escapes first
  if (escapeChar in SIMPLE_ESCAPES) {
    return { value: SIMPLE_ESCAPES[escapeChar], consumed: 0 };
  }

  // Handle hex escape
  if (escapeChar === "x") {
    const hexResult = processHexEscape(content);
    if (hexResult) {
      return hexResult;
    }
    return { value: "x", consumed: 0 };
  }

  // Handle unicode escape
  if (escapeChar === "u") {
    const unicodeResult = processUnicodeEscape(content);
    if (unicodeResult) {
      return unicodeResult;
    }
    return { value: "u", consumed: 0 };
  }

  // Unknown escape - keep the character
  return { value: escapeChar, consumed: 0 };
}

/**
 * Process escape sequences in a string, returning the unescaped result
 *
 * This centralizes the escape sequence logic that was duplicated in
 * parseStringLiteral and template literal parsing.
 *
 * @param content - The string content with escape sequences (without surrounding quotes)
 * @param additionalEscapes - Additional single-character escapes specific to the context
 *                           (e.g., ` and $ for template literals)
 * @returns The unescaped string
 */
export function processEscapeSequences(
  content: string,
  additionalEscapes: Readonly<Record<string, string>> = {},
): string {
  const escapes = { ...SIMPLE_ESCAPES, ...additionalEscapes };
  let result = "";
  let i = 0;

  while (i < content.length) {
    if (content[i] === "\\") {
      i++;
      if (i >= content.length) break;

      const escapeChar = content[i];

      // Check simple escapes first
      if (escapeChar in escapes) {
        result += escapes[escapeChar];
        i++;
        continue;
      }

      // Handle hex escape
      if (escapeChar === "x") {
        const hexResult = processHexEscape(content.slice(i + 1));
        if (hexResult) {
          result += hexResult.value;
          i += 1 + hexResult.consumed;
          continue;
        }
        // Invalid hex escape - keep as-is
        result += "x";
        i++;
        continue;
      }

      // Handle unicode escape
      if (escapeChar === "u") {
        const unicodeResult = processUnicodeEscape(content.slice(i + 1));
        if (unicodeResult) {
          result += unicodeResult.value;
          i += 1 + unicodeResult.consumed;
          continue;
        }
        // Invalid unicode escape - keep as-is
        result += "u";
        i++;
        continue;
      }

      // Unknown escape - keep the character
      result += escapeChar;
      i++;
    } else {
      result += content[i];
      i++;
    }
  }

  return result;
}
