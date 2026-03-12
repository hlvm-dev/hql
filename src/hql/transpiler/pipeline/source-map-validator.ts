/**
 * Source Map V3 Validator
 *
 * Pure utility for validating source maps against the Source Map V3 specification.
 * Uses the `vlq` package for Base64 VLQ decoding with error normalization.
 */

import { decode as vlqDecode } from "vlq";
import { getErrorMessage } from "../../../common/utils.ts";

export interface RawSourceMap {
  version: number;
  sources: string[];
  names: string[];
  mappings: string;
  sourcesContent?: (string | null)[];
  file?: string;
  sourceRoot?: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

class SourceMapValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceMapValidationError";
  }
}

// Base64 VLQ continuation bit mask — bit 5 indicates more sextets follow
const VLQ_CONTINUATION_BIT = 0x20;
const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Decode a Base64 VLQ encoded string into an array of integers.
 * Thin wrapper around the `vlq` package with truncation detection and error normalization.
 */
export function decodeVLQ(input: string): number[] {
  if (!input) return [];

  // Detect truncated input: last character must NOT have continuation bit set
  const lastCharValue = BASE64_CHARS.indexOf(input[input.length - 1]);
  if (lastCharValue === -1) {
    throw new SourceMapValidationError(
      `Invalid Base64 VLQ character: '${input[input.length - 1]}' at position ${input.length - 1}`,
    );
  }
  if ((lastCharValue & VLQ_CONTINUATION_BIT) !== 0) {
    throw new SourceMapValidationError(
      "Truncated VLQ value: unexpected end of input",
    );
  }

  try {
    return vlqDecode(input);
  } catch (e) {
    // Normalize vlq's "Invalid character (X)" to our expected format
    const msg = getErrorMessage(e);
    const charMatch = msg.match(/Invalid character \((.)\)/);
    if (charMatch) {
      const badChar = charMatch[1];
      const pos = input.indexOf(badChar);
      throw new SourceMapValidationError(
        `Invalid Base64 VLQ character: '${badChar}' at position ${pos}`,
      );
    }
    throw new SourceMapValidationError(msg);
  }
}

/**
 * Validate a source map object against the Source Map V3 specification.
 */
export function validateSourceMap(map: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Must be an object
  if (map === null || typeof map !== "object" || Array.isArray(map)) {
    return {
      valid: false,
      errors: ["Source map must be a non-null object"],
      warnings,
    };
  }

  const obj = map as Record<string, unknown>;

  // 2. version === 3
  if (!("version" in obj)) {
    errors.push("Missing required field: version");
  } else if (obj.version !== 3) {
    errors.push(`Invalid version: expected 3, got ${obj.version}`);
  }

  // 3. sources must be a non-empty string array
  if (!("sources" in obj)) {
    errors.push("Missing required field: sources");
  } else if (!Array.isArray(obj.sources)) {
    errors.push("'sources' must be an array");
  } else if (obj.sources.length === 0) {
    errors.push("'sources' must be a non-empty array");
  } else if (!obj.sources.every((s: unknown) => typeof s === "string")) {
    errors.push("'sources' must contain only strings");
  }

  // 4. names must be a string array (can be empty)
  if (!("names" in obj)) {
    errors.push("Missing required field: names");
  } else if (!Array.isArray(obj.names)) {
    errors.push("'names' must be an array");
  } else if (!obj.names.every((n: unknown) => typeof n === "string")) {
    errors.push("'names' must contain only strings");
  }

  // 5. mappings must be a string
  if (!("mappings" in obj)) {
    errors.push("Missing required field: mappings");
  } else if (typeof obj.mappings !== "string") {
    errors.push("'mappings' must be a string");
  }

  // If basic structure is invalid, return early before parsing mappings
  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  const sources = obj.sources as string[];
  const names = obj.names as string[];
  const mappings = obj.mappings as string;

  // 6. Parse and validate mappings
  const lines = mappings.split(";");

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (line === "") continue;

    const segments = line.split(",");
    let prevGeneratedColumn = 0;

    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      const segment = segments[segIdx];
      if (segment === "") continue;

      let fields: number[];
      try {
        fields = decodeVLQ(segment);
      } catch (e) {
        const msg = getErrorMessage(e);
        errors.push(`Line ${lineIdx + 1}, segment ${segIdx + 1}: ${msg}`);
        continue;
      }

      // Valid segment lengths: 1, 4, or 5
      if (fields.length !== 1 && fields.length !== 4 && fields.length !== 5) {
        errors.push(
          `Line ${lineIdx + 1}, segment ${
            segIdx + 1
          }: invalid field count ${fields.length} (expected 1, 4, or 5)`,
        );
        continue;
      }

      // Generated column must be non-decreasing within a line
      // Field 0 is a relative column offset; absolute = prev + offset
      const generatedColumn = prevGeneratedColumn + fields[0];
      if (generatedColumn < prevGeneratedColumn && fields[0] < 0) {
        // A negative offset that causes a decrease
        errors.push(
          `Line ${lineIdx + 1}, segment ${
            segIdx + 1
          }: generated column is not monotonically non-decreasing`,
        );
      }
      prevGeneratedColumn = generatedColumn;

      if (fields.length >= 4) {
        // fields[1] = source index (relative, but we track absolute for bounds check)
        // For bounds checking, we need to track the running source index
        // However, for a simple validator we check if the decoded relative value
        // would produce an out-of-bounds index. Since mappings use relative offsets,
        // we need to track state across segments.
      }

      if (fields.length === 5) {
        // fields[4] = name index (relative)
        // For a structural check, we verify names array exists and is non-empty
        // when name references are present
        if (names.length === 0) {
          errors.push(
            `Line ${lineIdx + 1}, segment ${
              segIdx + 1
            }: segment references names but names array is empty`,
          );
        }
      }
    }
  }

  // Validate mappings with full state tracking for source/name index bounds
  validateMappingIndices(mappings, sources.length, names.length, errors);

  // 7. sourcesContent length must match sources length
  if ("sourcesContent" in obj) {
    if (!Array.isArray(obj.sourcesContent)) {
      errors.push("'sourcesContent' must be an array");
    } else if (obj.sourcesContent.length !== sources.length) {
      warnings.push(
        `'sourcesContent' length (${obj.sourcesContent.length}) does not match 'sources' length (${sources.length})`,
      );
    }
  } else {
    warnings.push("Missing optional field: sourcesContent");
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate source and name indices in mappings using cumulative state tracking.
 */
function validateMappingIndices(
  mappings: string,
  sourceCount: number,
  nameCount: number,
  errors: string[],
): void {
  const lines = mappings.split(";");
  let absoluteSourceIndex = 0;
  let absoluteNameIndex = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (line === "") continue;

    const segments = line.split(",");
    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      const segment = segments[segIdx];
      if (segment === "") continue;

      let fields: number[];
      try {
        fields = decodeVLQ(segment);
      } catch {
        continue; // Already reported in the first pass
      }

      if (fields.length >= 4) {
        absoluteSourceIndex += fields[1];
        if (absoluteSourceIndex < 0 || absoluteSourceIndex >= sourceCount) {
          errors.push(
            `Line ${lineIdx + 1}, segment ${
              segIdx + 1
            }: source index ${absoluteSourceIndex} out of bounds (sources has ${sourceCount} entries)`,
          );
        }
      }

      if (fields.length === 5) {
        absoluteNameIndex += fields[4];
        if (absoluteNameIndex < 0 || absoluteNameIndex >= nameCount) {
          errors.push(
            `Line ${lineIdx + 1}, segment ${
              segIdx + 1
            }: name index ${absoluteNameIndex} out of bounds (names has ${nameCount} entries)`,
          );
        }
      }
    }
  }
}
