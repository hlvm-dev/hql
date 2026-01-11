/**
 * HQL REPL Memory Persistence
 * Auto-persists def/defn definitions to ~/.hql/memory.hql
 * Inspired by Smalltalk's "living system" - your REPL state persists across sessions
 */

import { parse } from "../../transpiler/pipeline/parser.ts";
import { isList, isSymbol, type SList, type SSymbol } from "../../s-exp/types.ts";
import { join } from "jsr:@std/path@1";
import { ensureDir } from "jsr:@std/fs@1";
import { escapeString } from "./string-utils.ts";

// ============================================================
// Debug Logging (writes to ~/.hql/memory-debug.log)
// ============================================================

async function debugLog(message: string): Promise<void> {
  try {
    const logPath = join(getHqlDir(), "memory-debug.log");
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;
    await Deno.writeTextFile(logPath, line, { append: true });
  } catch {
    // Ignore logging errors
  }
}

// ============================================================
// Constants
// ============================================================

const MEMORY_HEADER = "; HQL Memory - auto-persisted definitions\n; Edit freely - compacted on REPL startup\n\n";

// ============================================================
// Path helpers
// ============================================================

/** Get the .hql directory path */
function getHqlDir(): string {
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || ".";
  return join(home, ".hql");
}

/** Get the memory file path: ~/.hql/memory.hql */
export function getMemoryFilePath(): string {
  return join(getHqlDir(), "memory.hql");
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

// ============================================================
// File I/O helpers (DRY)
// ============================================================

/** Read and parse memory file, returns empty array if not found */
async function readAndParseMemory(): Promise<ParsedDefinition[]> {
  try {
    const content = await Deno.readTextFile(getMemoryFilePath());
    return parseMemoryContent(content);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return [];
    }
    throw error;
  }
}

/** Write definitions to memory file with header */
async function writeMemoryFile(definitions: ParsedDefinition[]): Promise<void> {
  const content = definitions.length > 0
    ? MEMORY_HEADER + definitions.map(d => d.code).join("\n\n") + "\n"
    : MEMORY_HEADER;
  await Deno.writeTextFile(getMemoryFilePath(), content);
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
 * Docstrings are stored as "; " prefixed comment lines above definitions.
 * Robust handling: if a new (def or (defn starts before current expression closes,
 * the current expression is malformed - skip it and continue with the new one.
 */
function parseMemoryContent(content: string): ParsedDefinition[] {
  const definitions: ParsedDefinition[] = [];
  const lines = content.split("\n");

  let i = 0;
  let pendingDocLines: string[] = []; // Accumulate docstring comment lines

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // Empty line: reset pending docstring
    if (trimmed === "") {
      pendingDocLines = [];
      i++;
      continue;
    }

    // Comment line: accumulate as potential docstring
    if (trimmed.startsWith(";")) {
      // Remove "; " prefix and store the content
      const docLine = trimmed.startsWith("; ") ? trimmed.slice(2) : trimmed.slice(1);
      pendingDocLines.push(docLine);
      i++;
      continue;
    }

    // Only process lines that start a definition
    if (!isDefinitionStart(trimmed)) {
      pendingDocLines = []; // Reset - not a docstring
      i++;
      continue;
    }

    // Found a definition start - capture docstring from pending comments
    const docstring = pendingDocLines.length > 0 ? pendingDocLines.join("\n") : undefined;
    pendingDocLines = []; // Reset for next definition

    // Extract the complete expression
    const codeLines: string[] = [];
    let parenDepth = 0;
    let foundNextDef = false;

    for (let j = i; j < lines.length; j++) {
      const currentLine = lines[j];
      const currentTrimmed = currentLine.trim();

      // Skip empty lines and comments within multi-line expressions
      if (j > i && (currentTrimmed === "" || currentTrimmed.startsWith(";"))) {
        codeLines.push(currentLine);
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

      // Count parens (doesn't handle parens inside strings, but good enough)
      for (const char of currentLine) {
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

/**
 * Strip leading comment lines from code.
 * Used to ensure docstring from state is the single source of truth.
 * Also trims leading whitespace from the first code line.
 */
function stripLeadingComments(code: string): string {
  const lines = code.split("\n");
  let startIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Skip empty lines and comment lines at the start
    if (trimmed === "" || trimmed.startsWith(";")) {
      startIndex = i + 1;
    } else {
      break;
    }
  }
  // Get remaining lines, trim leading whitespace from first line only
  const remaining = lines.slice(startIndex);
  if (remaining.length > 0) {
    remaining[0] = remaining[0].trimStart();
  }
  return remaining.join("\n");
}

/**
 * Save a definition to memory.hql (overwrites existing definition with same name)
 * For def: stores the serialized VALUE
 * For defn: stores the original source code (comments stripped, docstring from state used)
 *
 * Single source of truth: docstring parameter is canonical, any comments in code are stripped.
 * Auto-deduplicates: if a definition with the same name exists, it's replaced (no duplicates).
 *
 * @param docstring Optional docstring to preserve (stored as comment above definition)
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

  // Prepend docstring as comment if provided (single source of truth)
  if (docstring) {
    const docLines = docstring.split("\n").map(line => `; ${line}`).join("\n");
    code = docLines + "\n" + code;
    await debugLog(`Added docstring, final code length: ${code.length}`);
  }

  const path = getMemoryFilePath();
  await debugLog(`Memory file path: ${path}`);

  // Read existing definitions, filter out any with same name (auto-overwrite)
  const existing = await readAndParseMemory();
  await debugLog(`Existing definitions: ${existing.length}`);
  const filtered = existing.filter(d => d.name !== name);

  // Add new definition
  const newDef: ParsedDefinition = { kind, name, code, docstring };
  filtered.push(newDef);
  await debugLog(`Total definitions to write: ${filtered.length}`);

  // Write back (ensures no duplicates)
  try {
    await ensureDir(getHqlDir());
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
  const path = getMemoryFilePath();

  try {
    const [stat, definitions] = await Promise.all([
      Deno.stat(path),
      readAndParseMemory(),
    ]);
    return { path, count: definitions.length, size: stat.size };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
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
