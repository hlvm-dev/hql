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
import {
  TYPE_ICONS,
  TYPE_LABELS,
  COMPLETION_SCORES,
  RENDER_MAX_WIDTH,
  PROVIDER_HELP_TEXT,
  COMPLETION_DEBOUNCE_MS,
  ATTACHMENT_PLACEHOLDER,
  STRING_PLACEHOLDER_FUNCTIONS,
  CONTEXT_AWARE_FORMS,
} from "./types.ts";
import {
  resetItemIdCounter,
  generateItemId,
  shouldTriggerFileMention,
  extractMentionQuery,
  shouldTriggerCommand,
  extractCommandQuery,
  shouldTriggerSymbol,
} from "./providers.ts";
import { isSupportedMedia } from "../../repl/attachment.ts";
import { fuzzyMatch, type FuzzyResult } from "../../repl/fuzzy.ts";

// ============================================================
// Symbol Provider
// ============================================================

// Import shared sets and functions from known-identifiers.ts (single source of truth)
import {
  getAllKnownIdentifiers,
  initializeIdentifiers,
  classifyIdentifier as baseClassify,
} from "../../../../common/known-identifiers.ts";
import { COMMAND_CATALOG } from "../../repl/commands.ts";

/**
 * Classify an identifier into a completion type.
 * Extends base classifier with user binding check.
 */
function classifyIdentifier(
  id: string,
  userBindings: ReadonlySet<string>
): CompletionItem["type"] {
  if (userBindings.has(id)) return "variable";
  const base = baseClassify(id);
  return base === "other" ? "function" : base;
}

/**
 * Get description for an identifier.
 * Shows SIGNATURE inline (actionable info for calling the function).
 * Full docstring is shown in DocPanel separately to avoid duplication.
 */
function getDescription(
  id: string,
  _type: CompletionItem["type"],
  signatures: ReadonlyMap<string, readonly string[]>,
  _docstrings: ReadonlyMap<string, string>
): string | undefined {
  // Show function signature if available (e.g., "(x y)")
  // This is the most actionable info - tells you how to call it
  const sig = signatures.get(id);
  if (sig && sig.length > 0) {
    return `(${sig.join(" ")})`;
  }

  // No signature - type label will be shown on right side of dropdown
  return undefined;
}

/**
 * Create applyAction for symbol items.
 * For functions with params: BOTH Tab and Enter produce full form (funcname params...)
 * with placeholder mode for parameter filling.
 *
 * Opening paren is added if not already present before the completion.
 *
 * SPECIAL: Variables (def, no params) auto-execute - no second Enter needed!
 * This is because (varname) is a complete expression that can run immediately.
 */
function createSymbolApplyAction(
  id: string,
  params: readonly string[] | undefined,
  itemType: CompletionItem["type"]
): (action: CompletionAction, context: ApplyContext) => ApplyResult {
  const hasParams = params && params.length > 0;
  const isCallable = itemType === "function" || itemType === "macro" || hasParams;
  // Variables with no params are complete expressions - can auto-execute
  const isVariable = itemType === "variable" && !hasParams;
  // Context-aware forms should NOT enter placeholder mode - let dropdown show instead
  const isContextAwareForm = CONTEXT_AWARE_FORMS[id] !== undefined;
  const usesStringPlaceholder = STRING_PLACEHOLDER_FUNCTIONS.has(id);

  return (action: CompletionAction, ctx: ApplyContext): ApplyResult => {
    const before = ctx.text.slice(0, ctx.anchorPosition);
    const after = ctx.text.slice(ctx.cursorPosition);

    // Check if there's already an opening paren before the anchor
    // Look for "(" possibly with whitespace before the word
    const trimmedBefore = before.trimEnd();
    const hasOpeningParen = trimmedBefore.endsWith("(");

    // Check if there's already a closing paren after cursor (from auto-close feature)
    // If user typed "(" which auto-inserted ")", after will start with ")"
    const hasClosingParen = after.startsWith(")");

    // INSERT action: Simple text insertion (just the label, no smart completion)
    // User explicitly chose "just the name" by pressing Enter
    if (action === "INSERT") {
      const insertText = id + " ";
      return {
        text: before + insertText + after,
        cursorPosition: ctx.anchorPosition + insertText.length,
        closeDropdown: true,
      };
    }

    // SELECT action: Smart completion (add parens, params, placeholder mode)
    // User explicitly chose "full form" by pressing Tab

    // CONTEXT-AWARE FORMS (forget, inspect, describe): Skip placeholder mode!
    // Just insert the function name - let the auto-completion dropdown show options
    if (isContextAwareForm) {
      const openParen = hasOpeningParen ? "" : "(";
      const insertText = openParen + id + " ";
      return {
        text: before + insertText + after,
        cursorPosition: ctx.anchorPosition + insertText.length,
        closeDropdown: true,
        // No placeholder mode - dropdown will auto-trigger and show context-aware options
      };
    }

    // String-first AI helpers: insert quoted placeholder and position cursor inside.
    if (isCallable && usesStringPlaceholder) {
      const openParen = hasOpeningParen ? "" : "(";
      const closeParen = hasClosingParen ? "" : ")";
      const insertText = openParen + id + " \"\"" + closeParen;
      return {
        text: before + insertText + after,
        cursorPosition: ctx.anchorPosition + openParen.length + id.length + 2,
        closeDropdown: true,
      };
    }

    // For callable items (functions/macros with params): provide full form
    if (isCallable && hasParams) {
      // Build the full form: (funcname param1 param2...)
      const openParen = hasOpeningParen ? "" : "(";
      const paramsText = params!.join(" ");
      // Don't add closing paren if one already exists from auto-close
      const closeParen = hasClosingParen ? "" : ")";

      // Full completion: (funcname p1 p2)
      const insertText = openParen + id + " " + paramsText + closeParen;
      // If existing closing paren, don't add space before it; otherwise add trailing space
      const trailingSpace = hasClosingParen ? "" : " ";
      const newText = before + insertText + trailingSpace + after;

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

    // For VARIABLES (def, no params): complete expression, auto-execute!
    // (answer) is complete - no need for second Enter
    if (isVariable) {
      const openParen = hasOpeningParen ? "" : "(";
      const closeParen = hasClosingParen ? "" : ")";
      const insertText = openParen + id + closeParen;
      return {
        text: before + insertText + after,
        cursorPosition: ctx.anchorPosition + insertText.length,
        closeDropdown: true,
        // Auto-execute: no second Enter needed for variables
        sideEffect: { type: "EXECUTE" },
      };
    }

    // For other non-callable items (keywords, operators): just insert name
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
  description: string | undefined,
  matchIndices?: readonly number[],
  extendedDoc?: string
): () => ItemRenderSpec {
  return (): ItemRenderSpec => ({
    icon: TYPE_ICONS[type],
    label: id,
    truncate: "end",
    maxWidth: RENDER_MAX_WIDTH.SYMBOL,
    description,
    typeLabel: TYPE_LABELS[type],
    matchIndices,
    extendedDoc,
  });
}

/**
 * Provider for HQL symbol completions (keywords, functions, variables).
 */
export const SymbolProvider: CompletionProvider = {
  id: "symbol",
  isAsync: false,
  helpText: PROVIDER_HELP_TEXT.SIMPLE,
  appliesOnNavigate: false, // Arrow keys only navigate (no cycling - cleaner UX)

  shouldTrigger(context: CompletionContext): boolean {
    return shouldTriggerSymbol(context);
  },

  async getCompletions(context: CompletionContext): Promise<CompletionResult> {
    const prefix = context.currentWord;

    resetItemIdCounter();

    // Ensure identifiers are fully loaded (fixes race condition on startup)
    await initializeIdentifiers();

    const allIdentifiers = getAllKnownIdentifiers();
    const seen = new Set<string>();
    const items: CompletionItem[] = [];

    // ============================================================
    // Context-Aware Filtering
    // Check if we're inside a form that requires specific completions
    // ============================================================
    const enclosingForm = context.enclosingForm;
    const contextFilter = enclosingForm ? CONTEXT_AWARE_FORMS[enclosingForm.name] : undefined;

    // Determine which names to show based on context
    // - "memory": only show memoryNames (persistent definitions)
    // - "bindings": only show userBindings (session definitions)
    // - "functions": only show things with signatures
    // - undefined: show all (normal completion)
    const getContextFilteredNames = (): Set<string> | null => {
      if (!contextFilter) return null; // No filter - show all

      switch (contextFilter) {
        case "memory":
          return new Set(context.memoryNames);
        case "bindings":
          return new Set(context.userBindings);
        case "functions":
          // Return names that have signatures (are functions)
          return new Set(context.signatures.keys());
        default:
          return null;
      }
    };

    const allowedNames = getContextFilteredNames();

    // Helper to check if a name passes the context filter
    const passesContextFilter = (name: string): boolean => {
      if (!allowedNames) return true; // No filter - all pass
      return allowedNames.has(name);
    };

    // Helper to create item with fuzzy match result
    const createItem = (
      name: string,
      type: CompletionItem["type"],
      baseScore: number,
      matchResult: FuzzyResult | null
    ): CompletionItem | null => {
      // Check context filter FIRST
      if (!passesContextFilter(name)) return null;

      // For empty prefix, include all; for non-empty, require match
      if (prefix && !matchResult) return null;

      const params = context.signatures.get(name);
      const description = getDescription(name, type, context.signatures, context.docstrings);
      const matchIndices = matchResult?.indices;
      // Combine base score with fuzzy score for ranking
      const score = baseScore + (matchResult?.score ?? 0);

      // Extended doc is ONLY the docstring (shown in DocPanel)
      // Signature is already shown inline via getDescription()
      const extendedDoc = context.docstrings.get(name);

      return {
        id: generateItemId(type),
        label: name,
        type,
        description,
        score,
        matchIndices,
        availableActions: ["SELECT"] as const,
        applyAction: createSymbolApplyAction(name, params, type),
        getRenderSpec: createSymbolRenderSpec(name, type, description, matchIndices, extendedDoc),
      };
    };

    // Add USER BINDINGS FIRST - they override stdlib when names conflict
    // User's definitions should have higher priority than stdlib
    for (const binding of context.userBindings) {
      const matchResult = prefix ? fuzzyMatch(prefix, binding) : null;
      const item = createItem(binding, "variable", COMPLETION_SCORES.USER_BINDING, matchResult);
      if (item) {
        items.push(item);
        seen.add(binding);
      }
    }

    // Add matching known identifiers (skip if user already defined it)
    // Skip this entire loop if we're in a context that only allows user-defined names
    if (contextFilter !== "memory" && contextFilter !== "bindings") {
      for (const id of allIdentifiers) {
        if (seen.has(id)) continue;

        const matchResult = prefix ? fuzzyMatch(prefix, id) : null;
        const type = classifyIdentifier(id, context.userBindings);
        const item = createItem(id, type, COMPLETION_SCORES.STDLIB, matchResult);
        if (item) {
          items.push(item);
          seen.add(id);
        }
      }
    }

    // Sort by score (highest first) and limit results
    // More items for empty prefix (browsing), fewer for typed prefix (filtering)
    const limit = prefix ? 15 : 20;
    items.sort((a, b) => b.score - a.score);
    const ranked = items.slice(0, limit);

    return {
      items: ranked,
      anchor: context.wordStart,
    };
  },
};

// ============================================================
// File Provider
// ============================================================

import { searchFiles, unescapeShellPath, type FileMatch } from "../../repl/file-search.ts";

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

    // INSERT action: simple path insertion (same as SELECT for files)
    // SELECT on media file: create attachment
    if (isMedia && action === "SELECT") {
      // Use placeholder that will be replaced by actual display name
      return {
        text: before + ATTACHMENT_PLACEHOLDER + " " + after,
        cursorPosition: ctx.anchorPosition + ATTACHMENT_PLACEHOLDER.length + 1,
        closeDropdown: true,
        sideEffect: { type: "ADD_ATTACHMENT", path: cleanPath },
      };
    }

    // INSERT or SELECT on directory or regular file: insert with trailing space
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
  isDir: boolean,
  matchIndices?: readonly number[]
): () => ItemRenderSpec {
  return (): ItemRenderSpec => ({
    icon: isDir ? TYPE_ICONS.directory : TYPE_ICONS.file,
    label: path,
    truncate: "start", // Show end of path (filename)
    maxWidth: RENDER_MAX_WIDTH.FILE,
    matchIndices,
  });
}

/**
 * Provider for @mention file completions.
 */
export const FileProvider: CompletionProvider = {
  id: "file",
  isAsync: true,
  debounceMs: COMPLETION_DEBOUNCE_MS,
  helpText: PROVIDER_HELP_TEXT.DRILL,
  appliesOnNavigate: false, // Arrow keys only navigate (no auto-apply)

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
        getRenderSpec: createFileRenderSpec(match.path, isDir, match.matchIndices),
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

/**
 * Create applyAction for command items.
 * Commands only have SELECT - no drilling.
 * - SELECT: Execute command immediately (no second Enter needed)
 * - INSERT: Just insert command text (user can edit before executing)
 */
function createCommandApplyAction(
  name: string
): (action: CompletionAction, context: ApplyContext) => ApplyResult {
  return (action: CompletionAction, ctx: ApplyContext): ApplyResult => {
    const before = ctx.text.slice(0, ctx.anchorPosition);
    const after = ctx.text.slice(ctx.cursorPosition);

    // INSERT: Just insert the command text (user can edit and press Enter to execute)
    if (action === "INSERT") {
      const insertText = name + " ";
      return {
        text: before + insertText + after,
        cursorPosition: ctx.anchorPosition + insertText.length,
        closeDropdown: true,
      };
    }

    // SELECT: Execute immediately (no second Enter needed)
    const insertText = name;
    return {
      text: before + insertText + after,
      cursorPosition: ctx.anchorPosition + insertText.length,
      closeDropdown: true,
      sideEffect: { type: "EXECUTE" },
    };
  };
}

/**
 * Create getRenderSpec for command items.
 */
function createCommandRenderSpec(
  name: string,
  description: string,
  matchIndices?: readonly number[]
): () => ItemRenderSpec {
  return (): ItemRenderSpec => ({
    icon: TYPE_ICONS.command,
    label: name,
    truncate: "none",
    maxWidth: RENDER_MAX_WIDTH.COMMAND,
    description,
    matchIndices,
  });
}

/**
 * Provider for slash command completions.
 */
export const CommandProvider: CompletionProvider = {
  id: "command",
  isAsync: false,
  helpText: PROVIDER_HELP_TEXT.COMMAND,
  appliesOnNavigate: false, // Arrow keys only navigate (no auto-apply)

  shouldTrigger(context: CompletionContext): boolean {
    return shouldTriggerCommand(context);
  },

  getCompletions(context: CompletionContext): Promise<CompletionResult> {
    const query = extractCommandQuery(context);
    if (query === null) {
      return Promise.resolve({ items: [], anchor: context.cursorPosition });
    }

    // Find the / position for anchor
    const slashPos = context.textBeforeCursor.trimStart().indexOf("/");
    const leadingSpaces = context.textBeforeCursor.length - context.textBeforeCursor.trimStart().length;
    const anchor = leadingSpaces + slashPos;

    resetItemIdCounter();

    // Use fuzzy matching for command filtering
    const items: CompletionItem[] = [];

    for (const cmd of COMMAND_CATALOG) {
      // Fuzzy match against command name without the leading /
      const cmdName = cmd.name.slice(1); // Remove /
      const matchResult = query ? fuzzyMatch(query, cmdName) : null;

      // Include all for empty query, or only matches for non-empty
      if (query && !matchResult) continue;

      const score = COMPLETION_SCORES.COMMAND_BASE + (matchResult?.score ?? 0);
      // Shift indices by 1 to account for the leading /
      const matchIndices = matchResult?.indices.map(i => i + 1);

      items.push({
        id: generateItemId("command"),
        label: cmd.name,
        type: "command" as const,
        description: cmd.description,
        score,
        matchIndices,
        // Commands only support SELECT - no drilling
        availableActions: ["SELECT"] as const,
        applyAction: createCommandApplyAction(cmd.name),
        getRenderSpec: createCommandRenderSpec(cmd.name, cmd.description, matchIndices),
      });
    }

    // Sort by score (higher = better match)
    items.sort((a, b) => b.score - a.score);

    return Promise.resolve({
      items,
      anchor,
    });
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
