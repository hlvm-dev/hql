/**
 * Shared JSONL utilities.
 *
 * SSOT for common JSONL read/parse/append/write patterns used across
 * REPL history and transcript persistence.
 */

import { getPlatform } from "../platform/platform.ts";
import { isFileNotFoundError, LINE_SPLIT_REGEX } from "./utils.ts";

export type JsonlMapper<T> = (value: unknown) => T | undefined;

/**
 * Parse a single JSON line.
 * Empty or malformed input returns undefined.
 */
export function parseJsonLine<T>(line: string): T | undefined {
  if (!line.trim()) return undefined;
  try {
    return JSON.parse(line) as T;
  } catch {
    return undefined;
  }
}

/**
 * Parse JSONL content into typed records.
 * Malformed lines are skipped.
 */
export function parseJsonLines<T>(
  content: string,
  mapper?: JsonlMapper<T>,
): T[] {
  if (!content.trim()) return [];

  const lines = content.split(LINE_SPLIT_REGEX);
  const records: T[] = [];

  for (const line of lines) {
    const parsed = parseJsonLine<unknown>(line);
    if (parsed === undefined) continue;

    if (mapper) {
      const mapped = mapper(parsed);
      if (mapped !== undefined) records.push(mapped);
      continue;
    }

    records.push(parsed as T);
  }

  return records;
}

/**
 * Serialize records into newline-delimited JSON.
 * Returns empty string for empty input.
 */
export function serializeJsonLines(records: readonly unknown[]): string {
  if (records.length === 0) return "";
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

/**
 * Read and parse a JSONL file.
 * Missing file returns an empty array.
 */
export async function readJsonLines<T>(
  filePath: string,
  mapper?: JsonlMapper<T>,
): Promise<T[]> {
  try {
    const content = await getPlatform().fs.readTextFile(filePath);
    return parseJsonLines(content, mapper);
  } catch (error) {
    if (isFileNotFoundError(error)) return [];
    throw error;
  }
}

/**
 * Append one JSONL record.
 */
export async function appendJsonLine(
  filePath: string,
  record: unknown,
): Promise<void> {
  await appendJsonLines(filePath, [record]);
}

/**
 * Append multiple JSONL records.
 * Creates parent directory if needed.
 */
export async function appendJsonLines(
  filePath: string,
  records: readonly unknown[],
): Promise<void> {
  if (records.length === 0) return;

  const platform = getPlatform();
  const payload = serializeJsonLines(records);

  try {
    await platform.fs.writeTextFile(filePath, payload, { append: true });
  } catch (error) {
    if (!isFileNotFoundError(error)) throw error;
    await platform.fs.mkdir(platform.path.dirname(filePath), {
      recursive: true,
    });
    await platform.fs.writeTextFile(filePath, payload);
  }
}

/**
 * Atomic text write (temp file + rename).
 */
export async function atomicWriteTextFile(
  filePath: string,
  content: string,
): Promise<void> {
  const platform = getPlatform();
  const randomSuffix = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  const tempPath = `${filePath}.tmp.${Date.now()}.${randomSuffix}`;

  try {
    await platform.fs.mkdir(platform.path.dirname(filePath), {
      recursive: true,
    });
    await platform.fs.writeTextFile(tempPath, content);
    await platform.fs.rename(tempPath, filePath);
  } catch (error) {
    try {
      await platform.fs.remove(tempPath);
    } catch {
      // Ignore cleanup errors.
    }
    throw error;
  }
}
