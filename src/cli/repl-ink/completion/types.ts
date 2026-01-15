/**
 * Unified Completion System - Type Definitions
 *
 * Core interfaces for the completion dropdown system.
 * All providers produce CompletionItems, all UI consumes DropdownState.
 */

// ============================================================
// Action Types (for Tab/Enter behavior)
// ============================================================

/** Actions that can be performed on a completion item */
export type CompletionAction = "DRILL" | "SELECT" | "INSERT";
// INSERT: Simple text insertion (just the label, no smart completion)
// SELECT: Smart completion (add parens, params, placeholder mode)
// DRILL: Go deeper (for directories)

/** Context needed to apply a completion action */
export interface ApplyContext {
  /** Current input text */
  readonly text: string;
  /** Current cursor position */
  readonly cursorPosition: number;
  /** Anchor position (where completion word starts) */
  readonly anchorPosition: number;
}

/** Side effects that can be triggered by completion */
export type CompletionSideEffect =
  | { type: "ADD_ATTACHMENT"; path: string }
  | { type: "ENTER_PLACEHOLDER_MODE"; params: string[]; startPos: number }
  | { type: "EXECUTE" }  // Execute command immediately (for slash commands)
  | { type: "NONE" };

/** Result of applying a completion action */
export interface ApplyResult {
  /** New input text after applying */
  readonly text: string;
  /** New cursor position */
  readonly cursorPosition: number;
  /** Whether to close the dropdown after this action */
  readonly closeDropdown: boolean;
  /** Optional side effect (e.g., add attachment, enter placeholder mode) */
  readonly sideEffect?: CompletionSideEffect;
}

// ============================================================
// Rendering Abstraction
// ============================================================

/** How to render a completion item - provider defines this */
export interface ItemRenderSpec {
  /** Icon to display */
  readonly icon: string;
  /** Primary label text */
  readonly label: string;
  /** Label truncation strategy */
  readonly truncate: "start" | "end" | "none";
  /** Maximum label width before truncation */
  readonly maxWidth: number;
  /** Optional secondary text (description, signature) */
  readonly description?: string;
  /** Optional type label (right-aligned) */
  readonly typeLabel?: string;
  /** Matched character indices for highlighting (from fuzzy match) */
  readonly matchIndices?: readonly number[];
  /** Optional extended documentation (multi-line, shown in doc panel) */
  readonly extendedDoc?: string;
}

// ============================================================
// Completion Item Types
// ============================================================

/** Type of completion item for visual styling */
export type CompletionType =
  | "keyword"    // Language keywords: def, defn, if, let
  | "function"   // Stdlib functions: map, filter, reduce
  | "variable"   // User-defined bindings
  | "macro"      // Macros: ->, ->>, cond->
  | "operator"   // Primitive operators: +, -, *, /
  | "file"       // Regular files
  | "directory"  // Directories
  | "command";   // Slash commands: /help, /clear

/** Provider identifier */
export type ProviderId = "symbol" | "file" | "command";

/**
 * Universal completion item interface.
 * Every provider produces items conforming to this interface.
 *
 * Items define their own behavior through:
 * - availableActions: What actions (DRILL/SELECT) are supported
 * - applyAction: How to apply an action (provider defines behavior)
 * - getRenderSpec: How to render the item (provider defines appearance)
 */
export interface CompletionItem {
  /** Unique identifier within the completion session */
  readonly id: string;

  /** Primary display text (what user sees) */
  readonly label: string;

  /** Type for visual styling (icon, color) */
  readonly type: CompletionType;

  /** Optional description (signature, path, etc.) */
  readonly description?: string;

  /** Score for sorting (higher = better match) */
  readonly score: number;

  /** Match indices for fuzzy highlighting */
  readonly matchIndices?: readonly number[];

  /** Provider-specific metadata */
  readonly metadata?: Readonly<Record<string, unknown>>;

  // ============================================================
  // Action Semantics (NEW)
  // ============================================================

  /**
   * What actions are available for this item.
   * - DRILL: Go deeper (Tab on directory, Tab on function with params)
   * - SELECT: Choose this item (Enter on anything)
   */
  readonly availableActions: readonly CompletionAction[];

  /**
   * Apply an action to this item.
   * Provider defines the behavior - Input.tsx just calls this.
   */
  readonly applyAction: (action: CompletionAction, context: ApplyContext) => ApplyResult;

  /**
   * Get render specification for this item.
   * Provider controls how items look in the dropdown.
   */
  readonly getRenderSpec: () => ItemRenderSpec;
}

// ============================================================
// Completion Context
// ============================================================

/**
 * Represents the enclosing S-expression form at cursor position.
 * Used for context-aware completions (e.g., `forget` only shows memory names).
 */
export interface EnclosingForm {
  /** Name of the function/form (e.g., "forget", "inspect", "map") */
  readonly name: string;
  /** Argument index within the form (0-based) */
  readonly argIndex: number;
}

/**
 * Context-aware filtering modes for specific forms.
 * Maps form names to their expected argument types.
 */
export const CONTEXT_AWARE_FORMS: Record<string, "memory" | "bindings" | "functions"> = {
  // Memory operations - only show things in persistent memory
  "forget": "memory",
  // Inspection - show user bindings (defined in session)
  "inspect": "bindings",
  // Documentation - show functions (things with signatures)
  "describe": "functions",
} as const;

/**
 * Context passed to providers for generating completions.
 */
export interface CompletionContext {
  /** Full input text */
  readonly text: string;

  /** Cursor position in text */
  readonly cursorPosition: number;

  /** Text before cursor */
  readonly textBeforeCursor: string;

  /** Current word being completed */
  readonly currentWord: string;

  /** Position where current word starts */
  readonly wordStart: number;

  /** User-defined bindings from ReplState */
  readonly userBindings: ReadonlySet<string>;

  /** Function signatures from ReplState */
  readonly signatures: ReadonlyMap<string, readonly string[]>;

  /** Docstrings from comments (name -> description) */
  readonly docstrings: ReadonlyMap<string, string>;

  /** Whether cursor is inside a string literal (suppresses symbol completions) */
  readonly isInsideString: boolean;

  // ============================================================
  // Context-Aware Fields (NEW)
  // ============================================================

  /** Names of definitions stored in persistent memory */
  readonly memoryNames: ReadonlySet<string>;

  /** Enclosing form at cursor (for context-aware filtering) */
  readonly enclosingForm?: EnclosingForm;
}

// ============================================================
// Dropdown State
// ============================================================

/** Maximum visible items - fixed at 4 for stable UI (prevents dropdown height shaking) */
export const MAX_VISIBLE_ITEMS = 4;

/**
 * Dropdown state managed by useDropdownState hook.
 */
export interface DropdownState {
  /** Whether dropdown is visible */
  readonly isOpen: boolean;

  /** All items (may exceed visible window) */
  readonly items: readonly CompletionItem[];

  /** Currently selected index (-1 if none) */
  readonly selectedIndex: number;

  /** Position in input where completion word starts */
  readonly anchorPosition: number;

  /** Which provider is active */
  readonly providerId: ProviderId | null;

  /** Loading state for async providers */
  readonly isLoading: boolean;

  /** Whether user has toggled DocPanel with shortcut (Ctrl+D or ?) */
  readonly showDocPanel: boolean;

  // ============================================================
  // Session Tracking (for Tab cycling)
  // ============================================================

  /** Original text when completion session started */
  readonly originalText: string;

  /** Original cursor position when session started */
  readonly originalCursor: number;
}

/**
 * Initial dropdown state.
 */
export const INITIAL_DROPDOWN_STATE: DropdownState = {
  isOpen: false,
  items: [],
  selectedIndex: 0,
  anchorPosition: 0,
  providerId: null,
  isLoading: false,
  showDocPanel: false,
  // Session tracking
  originalText: "",
  originalCursor: 0,
};

// ============================================================
// Dropdown Actions
// ============================================================

/**
 * Actions for dropdown state reducer.
 */
export type DropdownAction =
  | { type: "OPEN"; items: readonly CompletionItem[]; anchor: number; providerId: ProviderId; originalText: string; originalCursor: number }
  | { type: "CLOSE" }
  | { type: "SET_ITEMS"; items: readonly CompletionItem[] }
  | { type: "SELECT_NEXT" }
  | { type: "SELECT_PREV" }
  | { type: "SELECT_INDEX"; index: number }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "TOGGLE_DOC_PANEL" };

// ============================================================
// Navigation Types
// ============================================================

/** Result of keyboard navigation */
export interface NavigationResult {
  /** New selected index */
  readonly newIndex: number;

  /**
   * Action to take:
   * - "navigate": Visual navigation only (Up/Down)
   * - "drill": Go deeper / smart select (Tab)
   * - "select": Choose and close (Enter)
   * - "cancel": Abort completion (Escape)
   * - "none": No action
   */
  readonly action: "navigate" | "drill" | "select" | "cancel" | "none";
}

/** Scroll window for virtualization */
export interface ScrollWindow {
  /** Start index (inclusive) */
  readonly start: number;

  /** End index (exclusive) */
  readonly end: number;
}

// ============================================================
// Provider Interface
// ============================================================

/**
 * Result from a completion provider.
 */
export interface CompletionResult {
  /** Completion items to display */
  readonly items: readonly CompletionItem[];
  /** Position in input where completion word starts (anchor for replacement) */
  readonly anchor: number;
  /** Whether more results are loading */
  readonly isLoading?: boolean;
}

/**
 * Interface for completion providers.
 * Implement this for new completion sources.
 *
 * Providers declare their behavior through:
 * - isAsync: Whether to debounce (for file search, etc.)
 * - debounceMs: Custom debounce delay
 * - helpText: Custom help text for the dropdown
 */
export interface CompletionProvider {
  /** Unique identifier */
  readonly id: ProviderId;

  /** Whether this provider is async (enables debouncing) */
  readonly isAsync?: boolean;

  /** Custom debounce delay in ms (default: 150 for async, 0 for sync) */
  readonly debounceMs?: number;

  /** Help text shown at bottom of dropdown */
  readonly helpText?: string;

  /** Whether arrow navigation applies selection immediately (cycling behavior) */
  readonly appliesOnNavigate?: boolean;

  /** Check if this provider should trigger for the current context */
  shouldTrigger(context: CompletionContext): boolean;

  /** Get completions for the context */
  getCompletions(context: CompletionContext): Promise<CompletionResult>;
}

// ============================================================
// Icon Mapping
// ============================================================

/** Icons for each completion type */
export const TYPE_ICONS: Record<CompletionType, string> = {
  keyword: "●",
  function: "ƒ",
  variable: "◆",
  macro: "λ",
  operator: "±",
  file: "📄",
  directory: "📁",
  command: "",   // No icon - slash commands are self-identifying
};

// ============================================================
// Completion Constants (Centralized)
// ============================================================

/** Score constants for ranking completions */
export const COMPLETION_SCORES = {
  USER_BINDING: 110,
  STDLIB: 100,
  COMMAND_BASE: 100,
} as const;

/** Max width for truncation by provider type */
export const RENDER_MAX_WIDTH = {
  SYMBOL: 16,
  FILE: 50,
  COMMAND: 20,
  DEFAULT: 40,
} as const;

/** Help text shown in dropdown (simplified for clean UI) */
export const PROVIDER_HELP_TEXT = {
  SIMPLE: "Tab select • Enter insert • Ctrl+D docs • Esc",
  DRILL: "Tab drill • Enter insert • Ctrl+D docs • Esc",
  COMMAND: "Tab run • Enter run • Ctrl+D docs • Esc",
} as const;

/** Debounce for async providers */
export const COMPLETION_DEBOUNCE_MS = 150;

/** Attachment placeholder (used in file provider and Input.tsx) */
export const ATTACHMENT_PLACEHOLDER = "{{ATTACHMENT}}";

/** Type labels shown on right side of dropdown */
export const TYPE_LABELS: Record<CompletionType, string> = {
  keyword: "keyword",
  function: "fn",
  variable: "def",
  macro: "macro",
  operator: "op",
  file: "file",
  directory: "dir",
  command: "cmd",
};

/** Type priority for sorting (lower = higher priority) */
export const TYPE_PRIORITY: Record<CompletionType, number> = {
  keyword: 1,
  macro: 2,
  function: 3,
  operator: 4,
  variable: 5,
  command: 6,
  directory: 7,
  file: 8,
};
