/**
 * Unified Completion System - Concrete Providers
 *
 * Implementations of CompletionProvider for:
 * - SymbolProvider: HQL keywords, functions, user bindings
 * - FileProvider: @mention file search
 * - CommandProvider: Slash commands
 */

import type {
  CompletionProvider,
  CompletionContext,
  CompletionResult,
  CompletionItem,
  CompletionAction,
  ApplyContext,
  ApplyResult,
  ItemRenderSpec,
} from "./types.ts";
import { TYPE_ICONS } from "./types.ts";
import {
  filterByPrefix,
  rankCompletions,
  createCompletionItem,
  resetItemIdCounter,
  generateItemId,
  shouldTriggerFileMention,
  extractMentionQuery,
  shouldTriggerCommand,
  extractCommandQuery,
  shouldTriggerSymbol,
} from "./providers.ts";
import { isSupportedMedia } from "../../repl/attachment.ts";

// ============================================================
// Symbol Provider
// ============================================================

// Import from existing completer for identifier data
import { getAllKnownIdentifiers, initializeIdentifiers } from "../../../common/known-identifiers.ts";
import {
  PRIMITIVE_OPS,
  KERNEL_PRIMITIVES,
  DECLARATION_KEYWORDS,
  BINDING_KEYWORDS,
} from "../../../transpiler/keyword/primitives.ts";
import {
  CONTROL_FLOW_KEYWORDS,
  THREADING_MACROS,
  extractMacroNames,
} from "../../../common/known-identifiers.ts";

// Pre-computed classification sets
const KEYWORD_SET: ReadonlySet<string> = new Set([
  ...CONTROL_FLOW_KEYWORDS,
  ...DECLARATION_KEYWORDS,
  ...BINDING_KEYWORDS,
  ...KERNEL_PRIMITIVES,
]);

const OPERATOR_SET: ReadonlySet<string> = PRIMITIVE_OPS;

const MACRO_SET: ReadonlySet<string> = new Set([
  ...THREADING_MACROS,
  ...extractMacroNames(),
]);

// Type labels shown on right side of dropdown
const TYPE_LABELS: Record<CompletionItem["type"], string> = {
  keyword: "keyword",
  function: "fn",
  variable: "def",
  macro: "macro",
  operator: "op",
  file: "file",
  directory: "dir",
  command: "cmd",
};

/**
 * Classify an identifier into a completion type.
 */
function classifyIdentifier(
  id: string,
  userBindings: ReadonlySet<string>
): CompletionItem["type"] {
  if (KEYWORD_SET.has(id)) return "keyword";
  if (OPERATOR_SET.has(id)) return "operator";
  if (MACRO_SET.has(id)) return "macro";
  if (userBindings.has(id)) return "variable";
  return "function";
}

/**
 * Get description for an identifier.
 * Priority: 1) Docstring from comment 2) Signature 3) Nothing
 */
function getDescription(
  id: string,
  _type: CompletionItem["type"],
  signatures: ReadonlyMap<string, readonly string[]>,
  docstrings: ReadonlyMap<string, string>
): string | undefined {
  // First: check for docstring from comment
  const doc = docstrings.get(id);
  if (doc) {
    return doc;
  }

  // Second: show function signature if available (e.g., "(x y)")
  const sig = signatures.get(id);
  if (sig && sig.length > 0) {
    return `(${sig.join(" ")})`;
  }

  // No description - type will be shown on right side of dropdown
  return undefined;
}

/**
 * Get type label for display on right side of dropdown.
 */
function getTypeLabel(type: CompletionItem["type"]): string {
  return TYPE_LABELS[type];
}

/**
 * Create applyAction for symbol items.
 * For functions with params: BOTH Tab and Enter produce full form (funcname params...)
 * with placeholder mode for parameter filling.
 *
 * Opening paren is added if not already present before the completion.
 */
function createSymbolApplyAction(
  id: string,
  params: readonly string[] | undefined,
  itemType: CompletionItem["type"]
): (action: CompletionAction, context: ApplyContext) => ApplyResult {
  const hasParams = params && params.length > 0;
  const isCallable = itemType === "function" || itemType === "macro" || hasParams;

  return (_action: CompletionAction, ctx: ApplyContext): ApplyResult => {
    const before = ctx.text.slice(0, ctx.anchorPosition);
    const after = ctx.text.slice(ctx.cursorPosition);

    // Check if there's already an opening paren before the anchor
    // Look for "(" possibly with whitespace before the word
    const trimmedBefore = before.trimEnd();
    const hasOpeningParen = trimmedBefore.endsWith("(");

    // For callable items (functions/macros with params): provide full form
    if (isCallable && hasParams) {
      // Build the full form: (funcname param1 param2...)
      const openParen = hasOpeningParen ? "" : "(";
      const paramsText = params!.join(" ");
      const closeParen = ")";

      // Full completion: (funcname p1 p2)
      const insertText = openParen + id + " " + paramsText + closeParen;
      const newText = before + insertText + " " + after;

      // Position cursor at first param
      const firstParamStart = ctx.anchorPosition + openParen.length + id.length + 1;

      return {
        text: newText,
        cursorPosition: firstParamStart,
        closeDropdown: true,
        sideEffect: {
          type: "ENTER_PLACEHOLDER_MODE",
          params: [...params!],
          startPos: firstParamStart,
        },
      };
    }

    // For callable items without known params: add parens but no placeholder
    if (isCallable && !hasParams) {
      const openParen = hasOpeningParen ? "" : "(";
      const insertText = openParen + id + " ";
      return {
        text: before + insertText + after,
        cursorPosition: ctx.anchorPosition + insertText.length,
        closeDropdown: true,
      };
    }

    // For non-callable items (keywords, operators, variables): just insert name
    const insertText = id + " ";
    return {
      text: before + insertText + after,
      cursorPosition: ctx.anchorPosition + insertText.length,
      closeDropdown: true,
    };
  };
}

/**
 * Create getRenderSpec for symbol items.
 */
function createSymbolRenderSpec(
  id: string,
  type: CompletionItem["type"],
  description: string | undefined
): () => ItemRenderSpec {
  return (): ItemRenderSpec => ({
    icon: TYPE_ICONS[type],
    label: id,
    truncate: "end",
    maxWidth: 16,
    description,
    typeLabel: TYPE_LABELS[type],
  });
}

/**
 * Provider for HQL symbol completions (keywords, functions, variables).
 */
export const SymbolProvider: CompletionProvider = {
  id: "symbol",
  isAsync: false,
  helpText: "↑↓ navigate • Tab/Enter select • Esc cancel",

  shouldTrigger(context: CompletionContext): boolean {
    return shouldTriggerSymbol(context);
  },

  async getCompletions(context: CompletionContext): Promise<CompletionResult> {
    const prefix = context.currentWord;
    const prefixLower = prefix.toLowerCase();

    resetItemIdCounter();

    // Ensure identifiers are fully loaded (fixes race condition on startup)
    await initializeIdentifiers();

    const allIdentifiers = getAllKnownIdentifiers();
    const seen = new Set<string>();
    const items: CompletionItem[] = [];

    // Add USER BINDINGS FIRST - they override stdlib when names conflict
    // User's definitions should have higher priority than stdlib
    for (const binding of context.userBindings) {
      // Match: prefix is empty OR binding starts with prefix (case-insensitive)
      // Include exact matches - user may want to see info about an identifier
      if (!prefix || binding.toLowerCase().startsWith(prefixLower)) {
        const params = context.signatures.get(binding);
        const description = getDescription(binding, "variable", context.signatures, context.docstrings);

        items.push({
          id: generateItemId("variable"),
          label: binding,
          type: "variable",
          description,
          score: 110,
          // Full completion: both Tab and Enter provide (funcname params...)
          availableActions: ["SELECT"] as const,
          applyAction: createSymbolApplyAction(binding, params, "variable"),
          getRenderSpec: createSymbolRenderSpec(binding, "variable", description),
        });
        seen.add(binding);
      }
    }

    // Add matching known identifiers (skip if user already defined it)
    for (const id of allIdentifiers) {
      // Match: prefix is empty OR id starts with prefix (case-insensitive)
      // Include exact matches - shows identifier info in dropdown
      if (!prefix || id.toLowerCase().startsWith(prefixLower)) {
        if (!seen.has(id)) {
          const type = classifyIdentifier(id, context.userBindings);
          const params = context.signatures.get(id);
          const description = getDescription(id, type, context.signatures, context.docstrings);

          items.push({
            id: generateItemId(type),
            label: id,
            type,
            description,
            score: 100,
            // Full completion: both Tab and Enter provide (funcname params...)
            availableActions: ["SELECT"] as const,
            applyAction: createSymbolApplyAction(id, params, type),
            getRenderSpec: createSymbolRenderSpec(id, type, description),
          });
          seen.add(id);
        }
      }
    }

    // Rank and limit results
    // More items for empty prefix (browsing), fewer for typed prefix (filtering)
    const limit = prefix ? 15 : 20;
    const ranked = rankCompletions(items).slice(0, limit);

    return {
      items: ranked,
      anchor: context.wordStart,
    };
  },
};

// ============================================================
// File Provider
// ============================================================

import { searchFiles, type FileMatch } from "../../repl/file-search.ts";

/**
 * Unescape shell path (remove backslashes before special chars).
 */
function unescapeShellPath(path: string): string {
  return path.replace(/\\([^\\])/g, "$1");
}

/**
 * Create applyAction for file items.
 * - DRILL on directory: drill in, keep dropdown open
 * - SELECT on directory/file: select and close
 * - SELECT on media: create attachment
 */
function createFileApplyAction(
  rawPath: string,
  isDir: boolean,
  isMedia: boolean
): (action: CompletionAction, context: ApplyContext) => ApplyResult {
  const cleanPath = unescapeShellPath(rawPath);

  return (action: CompletionAction, ctx: ApplyContext): ApplyResult => {
    const before = ctx.text.slice(0, ctx.anchorPosition);
    const after = ctx.text.slice(ctx.cursorPosition);

    // DRILL on directory: drill in, keep dropdown open for further navigation
    if (isDir && action === "DRILL") {
      // Insert the path with trailing / to continue browsing
      const insertPath = "@" + cleanPath + (cleanPath.endsWith("/") ? "" : "/");
      return {
        text: before + insertPath + after,
        cursorPosition: ctx.anchorPosition + insertPath.length,
        closeDropdown: false, // Keep open for drilling
      };
    }

    // SELECT on media file: create attachment
    if (isMedia) {
      // Use placeholder that will be replaced by actual display name
      return {
        text: before + "{{ATTACHMENT}}" + " " + after,
        cursorPosition: ctx.anchorPosition + "{{ATTACHMENT}}".length + 1,
        closeDropdown: true,
        sideEffect: { type: "ADD_ATTACHMENT", path: cleanPath },
      };
    }

    // SELECT on directory or regular file: insert with trailing space
    const insertPath = "@" + cleanPath + " ";
    return {
      text: before + insertPath + after,
      cursorPosition: ctx.anchorPosition + insertPath.length,
      closeDropdown: true,
    };
  };
}

/**
 * Create getRenderSpec for file items.
 * Files show path truncated from start (to show the filename).
 */
function createFileRenderSpec(
  path: string,
  isDir: boolean
): () => ItemRenderSpec {
  return (): ItemRenderSpec => ({
    icon: isDir ? TYPE_ICONS.directory : TYPE_ICONS.file,
    label: path,
    truncate: "start", // Show end of path (filename)
    maxWidth: 50,
  });
}

/**
 * Provider for @mention file completions.
 */
export const FileProvider: CompletionProvider = {
  id: "file",
  isAsync: true,
  debounceMs: 150,
  helpText: "↑↓ navigate • Tab drill • Enter select • Esc cancel",

  shouldTrigger(context: CompletionContext): boolean {
    return shouldTriggerFileMention(context);
  },

  async getCompletions(context: CompletionContext): Promise<CompletionResult> {
    const query = extractMentionQuery(context);
    if (query === null) {
      return { items: [], anchor: context.cursorPosition };
    }

    // Find the @ position for anchor
    const atPos = context.textBeforeCursor.lastIndexOf("@");

    resetItemIdCounter();

    // Use existing file search
    const matches = await searchFiles(query);

    const items: CompletionItem[] = matches.map((match: FileMatch) => {
      const isDir = match.isDirectory;
      const cleanPath = unescapeShellPath(match.path);
      const isMedia = !isDir && isSupportedMedia(cleanPath);

      return {
        id: generateItemId(isDir ? "directory" : "file"),
        label: match.path,
        type: isDir ? "directory" : "file",
        score: match.score,
        matchIndices: match.matchIndices,
        // Directories support DRILL + SELECT, files only SELECT
        availableActions: isDir ? ["DRILL", "SELECT"] as const : ["SELECT"] as const,
        applyAction: createFileApplyAction(match.path, isDir, isMedia),
        getRenderSpec: createFileRenderSpec(match.path, isDir),
      };
    });

    return {
      items,
      anchor: atPos,
    };
  },
};

// ============================================================
// Command Provider
// ============================================================

// Available commands (subset for autocompletion)
const AVAILABLE_COMMANDS: readonly { name: string; description: string }[] = [
  { name: "/help", description: "Show help message" },
  { name: "/clear", description: "Clear the screen" },
  { name: "/reset", description: "Reset REPL state" },
  { name: "/bindings", description: "Show current bindings" },
  { name: "/history", description: "Show command history" },
  { name: "/exit", description: "Exit the REPL" },
  { name: "/memory", description: "List saved definitions" },
  { name: "/forget", description: "Remove a definition" },
  { name: "/compact", description: "Compact memory file" },
  { name: "/js", description: "Toggle JavaScript mode" },
];

/**
 * Create applyAction for command items.
 * Commands only have SELECT - no drilling.
 */
function createCommandApplyAction(
  name: string
): (action: CompletionAction, context: ApplyContext) => ApplyResult {
  return (_action: CompletionAction, ctx: ApplyContext): ApplyResult => {
    const before = ctx.text.slice(0, ctx.anchorPosition);
    const after = ctx.text.slice(ctx.cursorPosition);
    const insertText = name + " ";

    return {
      text: before + insertText + after,
      cursorPosition: ctx.anchorPosition + insertText.length,
      closeDropdown: true,
    };
  };
}

/**
 * Create getRenderSpec for command items.
 */
function createCommandRenderSpec(
  name: string,
  description: string
): () => ItemRenderSpec {
  return (): ItemRenderSpec => ({
    icon: TYPE_ICONS.command,
    label: name,
    truncate: "none",
    maxWidth: 20,
    description,
  });
}

/**
 * Provider for slash command completions.
 */
export const CommandProvider: CompletionProvider = {
  id: "command",
  isAsync: false,
  helpText: "↑↓ navigate • Tab/Enter select • Esc cancel",

  shouldTrigger(context: CompletionContext): boolean {
    return shouldTriggerCommand(context);
  },

  async getCompletions(context: CompletionContext): Promise<CompletionResult> {
    const query = extractCommandQuery(context);
    if (query === null) {
      return { items: [], anchor: context.cursorPosition };
    }

    // Find the / position for anchor
    const slashPos = context.textBeforeCursor.trimStart().indexOf("/");
    const leadingSpaces = context.textBeforeCursor.length - context.textBeforeCursor.trimStart().length;
    const anchor = leadingSpaces + slashPos;

    resetItemIdCounter();

    // Filter commands by query
    const queryLower = query.toLowerCase();
    const items: CompletionItem[] = AVAILABLE_COMMANDS
      .filter((cmd) => cmd.name.toLowerCase().startsWith("/" + queryLower))
      .map((cmd, i) => ({
        id: generateItemId("command"),
        label: cmd.name,
        type: "command" as const,
        description: cmd.description,
        score: 100 - i,
        // Commands only support SELECT - no drilling
        availableActions: ["SELECT"] as const,
        applyAction: createCommandApplyAction(cmd.name),
        getRenderSpec: createCommandRenderSpec(cmd.name, cmd.description),
      }));

    return {
      items,
      anchor,
    };
  },
};

// ============================================================
// Provider Registry
// ============================================================

/**
 * All available completion providers, in priority order.
 * First matching provider wins.
 */
export const ALL_PROVIDERS: readonly CompletionProvider[] = [
  FileProvider,    // @ mentions (highest priority)
  CommandProvider, // / commands
  SymbolProvider,  // Tab completion (fallback)
];

/**
 * Get the active provider for the current context.
 * Returns null if no provider should trigger.
 */
export function getActiveProvider(
  context: CompletionContext
): CompletionProvider | null {
  for (const provider of ALL_PROVIDERS) {
    if (provider.shouldTrigger(context)) {
      return provider;
    }
  }
  return null;
}
