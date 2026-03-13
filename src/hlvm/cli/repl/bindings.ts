/**
 * HLVM REPL Bindings Persistence
 * Auto-persists def/defn definitions to ~/.hlvm/memory.hql
 * Inspired by Smalltalk's "living system" - your REPL state persists across sessions
 */

import { parse } from "../../../hql/transpiler/pipeline/parser.ts";
import {
  isList,
  isSymbol,
  type SList,
  type SSymbol,
} from "../../../hql/s-exp/types.ts";
import { escapeString } from "./string-utils.ts";
import { extractFnParams } from "./definition-utils.ts";
import {
  extractJsDocBlock,
  isLineComment,
  stripLeadingComments,
} from "./docstring.ts";
import { getHlvmDir, getMemoryPath } from "../../../common/paths.ts";
import { getLegacyMemoryPath } from "../../../common/legacy-migration.ts";
import { isFileNotFoundError } from "../../../common/utils.ts";
import { getPlatform } from "../../../platform/platform.ts";

// SSOT: Use platform layer for all file/path operations
const fs = () => getPlatform().fs;

// ============================================================
// Constants
// ============================================================

const BINDINGS_HEADER =
  "// HLVM Bindings - auto-persisted definitions\n// Edit freely - compacted on REPL startup\n\n";

/** Get the bindings file path: ~/.hlvm/memory.hql */
export function getBindingsFilePath(): string {
  return getMemoryPath();
}

let legacyMigrationChecked = false;

async function ensureLegacyBindingsMigrated(): Promise<void> {
  if (legacyMigrationChecked) return;
  legacyMigrationChecked = true;

  const legacyPath = getLegacyMemoryPath();
  const currentPath = getBindingsFilePath();

  const legacyContent = await readFileIfExists(legacyPath);
  if (legacyContent === null) {
    return;
  }

  const currentContent = await readFileIfExists(currentPath);
  if (currentContent === null) {
    await fs().ensureDir(getHlvmDir());
    await getPlatform().fs.writeTextFile(currentPath, legacyContent);
    return;
  }

  const legacyDefinitions = parseBindingsContent(legacyContent);
  if (legacyDefinitions.length === 0) {
    return;
  }

  const currentDefinitions = parseBindingsContent(currentContent);
  const currentNames = new Set(currentDefinitions.map((def) => def.name));
  const missingDefinitions = legacyDefinitions.filter((def) =>
    !currentNames.has(def.name)
  );

  if (missingDefinitions.length === 0) {
    return;
  }

  await writeBindingsFile([...currentDefinitions, ...missingDefinitions]);
}

async function readFileIfExists(path: string): Promise<string | null> {
  const platform = getPlatform();
  try {
    return await platform.fs.readTextFile(path);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Serialize a JavaScript value to HQL code
 * Used for def to store the evaluated VALUE, not the expression
 * Uses WeakSet for O(1) circular reference detection (no wasteful JSON.stringify)
 */
export function serializeValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): string | null {
  if (value === undefined) return null;
  if (value === null) return "null";

  const type = typeof value;

  if (type === "number" || type === "boolean") {
    return String(value);
  }

  if (type === "string") {
    // Use shared escape function (single source of truth)
    return `"${escapeString(value as string)}"`;
  }

  if (type === "function") {
    // Functions cannot be serialized - defn handles this separately
    return null;
  }

  // For objects/arrays: check circular reference with WeakSet (O(1) lookup)
  if (type === "object") {
    const obj = value as object;
    if (seen.has(obj)) return null; // Circular reference detected
    seen.add(obj);

    if (Array.isArray(value)) {
      const elements = value.map((v) => serializeValue(v, seen));
      if (elements.some((e) => e === null)) return null;
      return `[${elements.join(" ")}]`;
    }

    const entries = Object.entries(value as Record<string, unknown>);
    const pairs = entries.map(([k, v]) => {
      const serializedValue = serializeValue(v, seen);
      if (serializedValue === null) return null;
      return `"${k}": ${serializedValue}`;
    });

    if (pairs.some((p) => p === null)) return null;
    return `{${pairs.join(", ")}}`;
  }

  return null;
}

interface ParsedDefinition {
  kind: "def" | "defn";
  name: string;
  code: string;
  docstring?: string;
}

export interface BindingFunctionItem {
  id: string;
  name: string;
  kind: "def" | "defn";
  arity: number;
  params: string[];
  docstring?: string;
  icon?: string;
  sourceCode: string;
}

// ============================================================
// File I/O helpers (DRY)
// ============================================================

/** Read and parse bindings file, returns empty array if not found */
async function readAndParseBindings(): Promise<ParsedDefinition[]> {
  await ensureLegacyBindingsMigrated();
  const platform = getPlatform();
  try {
    const content = await platform.fs.readTextFile(getBindingsFilePath());
    return parseBindingsContent(content);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}

function formatDefinition(def: ParsedDefinition): string {
  if (!def.docstring) return def.code;
  const block = def.docstring.trimEnd();
  return `${block}\n${def.code}`;
}

function buildBindingsContent(definitions: ParsedDefinition[]): string {
  if (definitions.length === 0) {
    return BINDINGS_HEADER;
  }
  const formatted = definitions.map((def) => formatDefinition(def));
  return BINDINGS_HEADER + formatted.join("\n\n") + "\n";
}

function appendDefinitionToContent(
  content: string,
  def: ParsedDefinition,
): string {
  if (content.trim().length === 0) {
    return buildBindingsContent([def]);
  }
  let output = content;
  if (!output.endsWith("\n")) {
    output += "\n";
  }
  if (!output.endsWith("\n\n")) {
    output += "\n";
  }
  return `${output}${formatDefinition(def)}\n`;
}

/** Write definitions to bindings file with header */
async function writeBindingsFile(definitions: ParsedDefinition[]): Promise<void> {
  await ensureLegacyBindingsMigrated();
  const content = buildBindingsContent(definitions);
  await getPlatform().fs.writeTextFile(getBindingsFilePath(), content);
}

/**
 * Check if a trimmed line starts a new definition
 * Caller must pass already-trimmed string to avoid redundant .trim() calls
 */
function isDefinitionStart(trimmedLine: string): boolean {
  return trimmedLine.startsWith("(def ") || trimmedLine.startsWith("(defn ");
}

/**
 * Parse memory.hql content and extract definitions with docstrings.
 * Docstrings are stored as JSDoc/TSDoc blocks (starting with `/**` and ending with `* /`).
 * Robust handling: if a new (def or (defn starts before current expression closes,
 * the current expression is malformed - skip it and continue with the new one.
 */
function parseBindingsContent(content: string): ParsedDefinition[] {
  const definitions: ParsedDefinition[] = [];
  const lines = content.split("\n");

  let i = 0;
  let pendingDocBlock: string | null = null;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // Empty line: keep pending doc block (allows spacing)
    if (trimmed === "") {
      i++;
      continue;
    }

    if (!pendingDocBlock && trimmed.startsWith("/**")) {
      const extracted = extractJsDocBlock(lines, i);
      pendingDocBlock = extracted.block;
      i = extracted.endIndex + 1;
      continue;
    }

    // Non-doc comment lines break doc association
    if (isLineComment(trimmed)) {
      pendingDocBlock = null;
      i++;
      continue;
    }

    // Only process lines that start a definition
    if (!isDefinitionStart(trimmed)) {
      pendingDocBlock = null; // Reset - not a docstring
      i++;
      continue;
    }

    // Found a definition start - capture docstring from pending comments
    const docstring = pendingDocBlock ?? undefined;
    pendingDocBlock = null; // Reset for next definition

    // Extract the complete expression
    const codeLines: string[] = [];
    let parenDepth = 0;
    let foundNextDef = false;

    for (let j = i; j < lines.length; j++) {
      const currentLine = lines[j];
      const currentTrimmed = currentLine.trim();

      // Skip empty lines and line comments within multi-line expressions
      if (j > i && (currentTrimmed === "" || isLineComment(currentTrimmed))) {
        if (currentTrimmed === "" || currentTrimmed.startsWith("//")) {
          codeLines.push(currentLine);
        }
        continue;
      }

      if (j > i && currentTrimmed.startsWith("/**")) {
        const extracted = extractJsDocBlock(lines, j);
        j = extracted.endIndex;
        continue;
      }

      // Check if this line (not the first) starts a new definition
      // This means the previous expression was malformed (unclosed paren)
      if (j > i && isDefinitionStart(currentTrimmed)) {
        foundNextDef = true;
        i = j; // Next iteration will process this new definition
        break;
      }

      codeLines.push(currentLine);

      // Count parens, skipping those inside string literals
      let inStr = false;
      for (let ci = 0; ci < currentLine.length; ci++) {
        const char = currentLine[ci];
        if (char === '"' && (ci === 0 || currentLine[ci - 1] !== "\\")) {
          inStr = !inStr;
          continue;
        }
        if (inStr) continue;
        if (char === "(") parenDepth++;
        if (char === ")") parenDepth--;
      }

      // Expression complete when balanced
      if (parenDepth <= 0) {
        i = j + 1; // Next iteration starts after this expression
        break;
      }
    }

    const currentCode = codeLines.join("\n");

    // If we found a next def without closing, skip this malformed expression
    if (foundNextDef) {
      continue;
    }

    // If we reached end of file without balancing, skip this malformed expression
    if (parenDepth !== 0) {
      break; // Nothing more to process
    }

    // Try to parse the expression
    try {
      const ast = parse(currentCode, "<memory>");
      if (ast.length > 0 && isList(ast[0])) {
        const list = ast[0] as SList;
        if (
          list.elements.length >= 2 && isSymbol(list.elements[0]) &&
          isSymbol(list.elements[1])
        ) {
          const op = (list.elements[0] as SSymbol).name;
          const name = (list.elements[1] as SSymbol).name;

          if (op === "def" || op === "defn") {
            definitions.push({
              kind: op,
              name,
              code: currentCode.trim(),
              docstring,
            });
          }
        }
      }
    } catch {
      // Skip malformed expressions
    }
  }

  return definitions;
}

/**
 * Compact bindings file by removing duplicate definitions (keep latest)
 * Called on REPL startup before loading
 */
export async function compactBindings(): Promise<
  { before: number; after: number }
> {
  const definitions = await readAndParseBindings();

  if (definitions.length === 0) {
    return { before: 0, after: 0 };
  }

  // Keep only the latest definition for each name
  const nameToDefinition = new Map<string, ParsedDefinition>();
  for (const def of definitions) {
    nameToDefinition.set(def.name, def);
  }

  const uniqueDefinitions = Array.from(nameToDefinition.values());

  // Only rewrite if we removed duplicates
  if (uniqueDefinitions.length < definitions.length) {
    await writeBindingsFile(uniqueDefinitions);
  }

  return { before: definitions.length, after: uniqueDefinitions.length };
}

/**
 * Load bindings file on REPL startup
 * Returns the count of loaded definitions, any errors, and docstrings to register
 */
export async function loadBindings(
  evaluator: (code: string) => Promise<{ success: boolean; error?: Error }>,
): Promise<
  { count: number; errors: string[]; docstrings: Map<string, string> }
> {
  const definitions = await readAndParseBindings();
  const errors: string[] = [];
  const docstrings = new Map<string, string>();
  let successCount = 0;

  for (const def of definitions) {
    const result = await evaluator(def.code);
    if (result.success) {
      successCount++;
      // Collect docstrings for successfully loaded definitions
      if (def.docstring) {
        docstrings.set(def.name, def.docstring);
      }
    } else {
      errors.push(`${def.name}: ${result.error?.message || "Unknown error"}`);
    }
  }

  return { count: successCount, errors, docstrings };
}

function extractParamsFromDefnCode(code: string): string[] {
  try {
    const ast = parse(code, "<memory>");
    if (ast.length === 0 || !isList(ast[0])) return [];
    const list = ast[0] as SList;
    if (list.elements.length < 3 || !isSymbol(list.elements[0])) return [];
    const op = (list.elements[0] as SSymbol).name;
    const params = extractFnParams(list, op);
    return params ?? [];
  } catch {
    return [];
  }
}

export async function listBindingFunctions(): Promise<BindingFunctionItem[]> {
  const definitions = await readAndParseBindings();
  return definitions.map((def) => {
    const params = def.kind === "defn"
      ? extractParamsFromDefnCode(def.code)
      : [];
    return {
      id: def.name,
      name: def.name,
      kind: def.kind,
      arity: def.kind === "defn" ? params.length : 0,
      params,
      docstring: def.docstring,
      icon: undefined,
      sourceCode: def.code,
    };
  });
}

/**
 * Save a definition to the bindings file (overwrites existing definition with same name)
 * For def: stores the serialized VALUE
 * For defn: stores the original source code (comments stripped, docstring from state used)
 *
 * Single source of truth: docstring parameter is canonical, any comments in code are stripped.
 * Auto-deduplicates: if a definition with the same name exists, it's replaced (no duplicates).
 *
 * @param docstring Optional JSDoc/TSDoc block to preserve (stored above definition)
 */
export async function appendToBindings(
  name: string,
  kind: "def" | "defn",
  codeOrValue: string | unknown,
  docstring?: string,
): Promise<void> {
  // Build the code first (fail fast if unserializable)
  let code: string;
  if (kind === "defn") {
    code = stripLeadingComments(codeOrValue as string);
  } else {
    const serialized = serializeValue(codeOrValue);
    if (serialized === null) return; // Unserializable value
    code = `(def ${name} ${serialized})`;
  }

  const bindingsPath = getBindingsFilePath();
  const existingContent = await readFileIfExists(bindingsPath);
  const existing = existingContent ? parseBindingsContent(existingContent) : [];
  const newDef: ParsedDefinition = { kind, name, code, docstring };

  // Fallback: if parse returned 0 but file has def/defn content, append without rewrite
  if (
    existing.length === 0 && existingContent &&
    /\(defn?\s+/.test(existingContent)
  ) {
    await fs().ensureDir(getHlvmDir());
    await getPlatform().fs.writeTextFile(
      bindingsPath,
      appendDefinitionToContent(existingContent, newDef),
    );
    return;
  }

  const filtered = existing.filter((d) => d.name !== name);
  filtered.push(newDef);
  await fs().ensureDir(getHlvmDir());
  await writeBindingsFile(filtered);
}

/**
 * Remove a definition from the bindings file by name
 */
export async function removeBinding(name: string): Promise<boolean> {
  const definitions = await readAndParseBindings();
  const filtered = definitions.filter((d) => d.name !== name);

  if (filtered.length === definitions.length) {
    return false; // Name not found
  }

  await writeBindingsFile(filtered);
  return true;
}

/**
 * Get bindings file statistics
 */
export async function getBindingStats(): Promise<
  { path: string; count: number; size: number } | null
> {
  const platform = getPlatform();
  const path = getBindingsFilePath();

  try {
    const [stat, definitions] = await Promise.all([
      platform.fs.stat(path),
      readAndParseBindings(),
    ]);
    return { path, count: definitions.length, size: stat.size };
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return { path, count: 0, size: 0 };
    }
    return null;
  }
}

/**
 * Get all definition names from bindings
 */
export async function getBindingNames(): Promise<string[]> {
  const definitions = await readAndParseBindings();
  return definitions.map((d) => d.name);
}

/**
 * Get the source code for a specific definition by name
 */
export async function getDefinitionSource(
  name: string,
): Promise<string | null> {
  const definitions = await readAndParseBindings();
  const def = definitions.find((d) => d.name === name);
  return def?.code ?? null;
}

/**
 * Clear all definitions from bindings file
 * Resets to empty state with just the header
 */
export async function clearBindings(): Promise<void> {
  await writeBindingsFile([]);
}
