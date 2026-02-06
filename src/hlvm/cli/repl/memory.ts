/**
 * HLVM REPL Memory Persistence
 * Auto-persists def/defn definitions to ~/.hlvm/memory.hql
 * Inspired by Smalltalk's "living system" - your REPL state persists across sessions
 */

import { parse } from "../../../hql/transpiler/pipeline/parser.ts";
import { isList, isSymbol, type SList, type SSymbol } from "../../../hql/s-exp/types.ts";
import { escapeString } from "./string-utils.ts";
import { extractFnParams } from "./definition-utils.ts";
import { extractJsDocBlock, isLineComment, stripLeadingComments } from "./docstring.ts";
import { getHlvmDir, getMemoryPath } from "../../../common/paths.ts";
import { getLegacyMemoryPath } from "../../../common/legacy-migration.ts";
import { getPlatform } from "../../../platform/platform.ts";

// SSOT: Use platform layer for all file/path operations
const fs = () => getPlatform().fs;
const path = () => getPlatform().path;

// ============================================================
// Debug Logging (writes to ~/.hlvm/memory-debug.log)
// ============================================================

async function debugLog(message: string): Promise<void> {
  try {
    const logPath = path().join(getHlvmDir(), "memory-debug.log");
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;
    await getPlatform().fs.writeTextFile(logPath, line, { append: true });
  } catch {
    // Ignore logging errors
  }
}

// ============================================================
// Constants
// ============================================================

const MEMORY_HEADER = "// HLVM Memory - auto-persisted definitions\n// Edit freely - compacted on REPL startup\n\n";

/** Get the memory file path: ~/.hlvm/memory.hql */
export function getMemoryFilePath(): string {
  return getMemoryPath();
}

let legacyMigrationChecked = false;

async function ensureLegacyMemoryMigrated(): Promise<void> {
  if (legacyMigrationChecked) return;
  legacyMigrationChecked = true;

  const legacyPath = getLegacyMemoryPath();
  const currentPath = getMemoryFilePath();

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

  const legacyDefinitions = parseMemoryContent(legacyContent);
  if (legacyDefinitions.length === 0) {
    return;
  }

  const currentDefinitions = parseMemoryContent(currentContent);
  const currentNames = new Set(currentDefinitions.map((def) => def.name));
  const missingDefinitions = legacyDefinitions.filter((def) => !currentNames.has(def.name));

  if (missingDefinitions.length === 0) {
    return;
  }

  await writeMemoryFile([...currentDefinitions, ...missingDefinitions]);
}

async function readFileIfExists(path: string): Promise<string | null> {
  const platform = getPlatform();
  try {
    return await platform.fs.readTextFile(path);
  } catch (error) {
    if (error instanceof Error && error.name === "NotFound") {
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
export function serializeValue(value: unknown, seen: WeakSet<object> = new WeakSet()): string | null {
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
      const elements = value.map(v => serializeValue(v, seen));
      if (elements.some(e => e === null)) return null;
      return `[${elements.join(" ")}]`;
    }

    const entries = Object.entries(value as Record<string, unknown>);
    const pairs = entries.map(([k, v]) => {
      const serializedValue = serializeValue(v, seen);
      if (serializedValue === null) return null;
      return `"${k}": ${serializedValue}`;
    });

    if (pairs.some(p => p === null)) return null;
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

export interface MemoryFunctionItem {
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

/** Read and parse memory file, returns empty array if not found */
async function readAndParseMemory(): Promise<ParsedDefinition[]> {
  await ensureLegacyMemoryMigrated();
  const platform = getPlatform();
  try {
    const content = await platform.fs.readTextFile(getMemoryFilePath());
    return parseMemoryContent(content);
  } catch (error) {
    if (error instanceof Error && error.name === "NotFound") {
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

function buildMemoryContent(definitions: ParsedDefinition[]): string {
  if (definitions.length === 0) {
    return MEMORY_HEADER;
  }
  const formatted = definitions.map((def) => formatDefinition(def));
  return MEMORY_HEADER + formatted.join("\n\n") + "\n";
}

function appendDefinitionToContent(content: string, def: ParsedDefinition): string {
  if (content.trim().length === 0) {
    return buildMemoryContent([def]);
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

function contentHasDefinitions(content: string): boolean {
  return /\(defn\s+|\(def\s+/.test(content);
}

/** Write definitions to memory file with header */
async function writeMemoryFile(definitions: ParsedDefinition[]): Promise<void> {
  await ensureLegacyMemoryMigrated();
  const content = buildMemoryContent(definitions);
  await getPlatform().fs.writeTextFile(getMemoryFilePath(), content);
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
function parseMemoryContent(content: string): ParsedDefinition[] {
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
        if (char === '"' && (ci === 0 || currentLine[ci - 1] !== '\\')) {
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
        if (list.elements.length >= 2 && isSymbol(list.elements[0]) && isSymbol(list.elements[1])) {
          const op = (list.elements[0] as SSymbol).name;
          const name = (list.elements[1] as SSymbol).name;

          if (op === "def" || op === "defn") {
            definitions.push({ kind: op, name, code: currentCode.trim(), docstring });
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
 * Compact memory.hql by removing duplicate definitions (keep latest)
 * Called on REPL startup before loading
 */
export async function compactMemory(): Promise<{ before: number; after: number }> {
  const definitions = await readAndParseMemory();

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
    await writeMemoryFile(uniqueDefinitions);
  }

  return { before: definitions.length, after: uniqueDefinitions.length };
}

/**
 * Load memory.hql on REPL startup
 * Returns the count of loaded definitions, any errors, and docstrings to register
 */
export async function loadMemory(evaluator: (code: string) => Promise<{ success: boolean; error?: Error }>): Promise<{ count: number; errors: string[]; docstrings: Map<string, string> }> {
  const definitions = await readAndParseMemory();
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

export async function listMemoryFunctions(): Promise<MemoryFunctionItem[]> {
  const definitions = await readAndParseMemory();
  return definitions.map((def) => {
    const params = def.kind === "defn" ? extractParamsFromDefnCode(def.code) : [];
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
 * Save a definition to memory.hql (overwrites existing definition with same name)
 * For def: stores the serialized VALUE
 * For defn: stores the original source code (comments stripped, docstring from state used)
 *
 * Single source of truth: docstring parameter is canonical, any comments in code are stripped.
 * Auto-deduplicates: if a definition with the same name exists, it's replaced (no duplicates).
 *
 * @param docstring Optional JSDoc/TSDoc block to preserve (stored above definition)
 */
export async function appendToMemory(
  name: string,
  kind: "def" | "defn",
  codeOrValue: string | unknown,
  docstring?: string
): Promise<void> {
  await debugLog(`appendToMemory called: name=${name}, kind=${kind}, hasDocstring=${!!docstring}`);

  // Build the code first (fail fast if unserializable)
  let code: string;
  if (kind === "defn") {
    // Strip any leading comments - docstring from state is the single source of truth
    code = stripLeadingComments(codeOrValue as string);
    await debugLog(`defn code after strip: ${code.slice(0, 100)}...`);
  } else {
    const serialized = serializeValue(codeOrValue);
    if (serialized === null) {
      await debugLog(`EARLY RETURN: serializeValue returned null for ${name}`);
      return; // Unserializable value
    }
    code = `(def ${name} ${serialized})`;
    await debugLog(`def code: ${code}`);
  }

  const path = getMemoryFilePath();
  await debugLog(`Memory file path: ${path}`);

  const existingContent = await readFileIfExists(path);
  const existing = await readAndParseMemory();
  await debugLog(`Existing definitions: ${existing.length}`);

  const newDef: ParsedDefinition = { kind, name, code, docstring };

  if (existing.length === 0 && existingContent && contentHasDefinitions(existingContent)) {
    await debugLog("Parse returned 0 definitions but file has content; appending without rewrite");
    const appended = appendDefinitionToContent(existingContent, newDef);
    try {
      await fs().ensureDir(getHlvmDir());
      await debugLog("ensureDir succeeded");
      await getPlatform().fs.writeTextFile(path, appended);
      await debugLog("appendDefinitionToContent succeeded - DONE");
    } catch (err) {
      await debugLog(`ERROR in append fallback: ${err}`);
      throw err;
    }
    return;
  }

  const filtered = existing.filter(d => d.name !== name);
  filtered.push(newDef);
  await debugLog(`Total definitions to write: ${filtered.length}`);

  try {
    await fs().ensureDir(getHlvmDir());
    await debugLog(`ensureDir succeeded`);
    await writeMemoryFile(filtered);
    await debugLog(`writeMemoryFile succeeded - DONE`);
  } catch (err) {
    await debugLog(`ERROR in write: ${err}`);
    throw err;
  }
}

/**
 * Remove a definition from memory.hql by name
 */
export async function forgetFromMemory(name: string): Promise<boolean> {
  const definitions = await readAndParseMemory();
  const filtered = definitions.filter(d => d.name !== name);

  if (filtered.length === definitions.length) {
    return false; // Name not found
  }

  await writeMemoryFile(filtered);
  return true;
}

/**
 * Get memory file statistics
 */
export async function getMemoryStats(): Promise<{ path: string; count: number; size: number } | null> {
  const platform = getPlatform();
  const path = getMemoryFilePath();

  try {
    const [stat, definitions] = await Promise.all([
      platform.fs.stat(path),
      readAndParseMemory(),
    ]);
    return { path, count: definitions.length, size: stat.size };
  } catch (error) {
    if (error instanceof Error && error.name === "NotFound") {
      return { path, count: 0, size: 0 };
    }
    return null;
  }
}

/**
 * Get all definition names from memory
 */
export async function getMemoryNames(): Promise<string[]> {
  const definitions = await readAndParseMemory();
  return definitions.map(d => d.name);
}

/**
 * Get the source code for a specific definition by name
 */
export async function getDefinitionSource(name: string): Promise<string | null> {
  const definitions = await readAndParseMemory();
  const def = definitions.find(d => d.name === name);
  return def?.code ?? null;
}

/**
 * Clear all definitions from memory.hql (nuke memory)
 * Resets to empty state with just the header
 */
export async function clearMemory(): Promise<void> {
  await writeMemoryFile([]);
}
