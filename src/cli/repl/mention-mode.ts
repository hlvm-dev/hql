/**
 * Mention Mode - @ file reference dropdown UI
 *
 * Renders a Claude Code-style dropdown below the input line
 * for fuzzy file/directory selection.
 *
 * Uses ANSI escape sequences for cursor manipulation:
 * - \x1b[B  - Move cursor down 1 line (doesn't create new lines)
 * - \x1b[nA - Move cursor up n lines (relative movement)
 * - \x1b[2K - Clear entire line
 * - \r     - Carriage return (go to column 0)
 *
 * Key insight: Uses relative cursor movement (not save/restore)
 * because save/restore breaks when terminal scrolls.
 */

import { ANSI_COLORS } from "../ansi.ts";
import { searchFiles, type FileMatch } from "./file-search.ts";

const { CYAN, DIM_GRAY, YELLOW, BOLD, RESET } = ANSI_COLORS;

// ============================================================
// Types
// ============================================================

export interface MentionState {
  /** Whether mention mode is active */
  active: boolean;
  /** The query text (after @) */
  query: string;
  /** Position where @ was typed */
  atPosition: number;
  /** Current search results */
  matches: FileMatch[];
  /** Currently selected index */
  selectedIndex: number;
  /** Number of visible lines in dropdown */
  visibleLines: number;
  /** Last rendered dropdown height (for cleanup) */
  lastDropdownHeight: number;
}

// ============================================================
// Constants
// ============================================================

const MAX_VISIBLE_RESULTS = 10;

// ANSI sequences - using relative movement (no save/restore which breaks on scroll)
const CLEAR_LINE = "\x1b[2K";
const CURSOR_DOWN = "\x1b[B";
const CURSOR_UP = (n: number) => `\x1b[${n}A`;
const CARRIAGE_RETURN = "\r";

// ============================================================
// State Factory
// ============================================================

export function createMentionState(): MentionState {
  return {
    active: false,
    query: "",
    atPosition: 0,
    matches: [],
    selectedIndex: 0,
    visibleLines: 0,
    lastDropdownHeight: 0,
  };
}

// ============================================================
// Formatting
// ============================================================

/**
 * Highlight matched characters in a path
 */
function highlightMatches(path: string, indices: number[]): string {
  if (indices.length === 0) return path;

  const indexSet = new Set(indices);
  let result = "";
  let inHighlight = false;

  for (let i = 0; i < path.length; i++) {
    const shouldHighlight = indexSet.has(i);

    if (shouldHighlight && !inHighlight) {
      result += YELLOW;
      inHighlight = true;
    } else if (!shouldHighlight && inHighlight) {
      result += RESET;
      inHighlight = false;
    }

    result += path[i];
  }

  if (inHighlight) {
    result += RESET;
  }

  return result;
}

/**
 * Format a single dropdown row
 */
function formatRow(match: FileMatch, isSelected: boolean, _width: number): string {
  const icon = match.isDirectory ? "📁" : "📄";
  const prefix = isSelected ? `${CYAN}❯ ` : "  ";

  // Highlight matched characters
  const highlightedPath = highlightMatches(match.path, match.matchIndices);

  // Apply selection styling
  const pathDisplay = isSelected
    ? `${BOLD}${highlightedPath}${RESET}`
    : `${DIM_GRAY}${highlightedPath}${RESET}`;

  const line = `${prefix}${icon} ${pathDisplay}`;

  return line;
}

/**
 * Format the entire dropdown
 */
export function formatDropdown(state: MentionState, terminalWidth = 80): string[] {
  const lines: string[] = [];

  if (state.matches.length === 0) {
    lines.push(`  ${DIM_GRAY}No matches found${RESET}`);
    return lines;
  }

  // Header
  lines.push(`${DIM_GRAY}─── Files (${state.matches.length} match${state.matches.length === 1 ? "" : "es"}) ───${RESET}`);

  // Results
  const visibleMatches = state.matches.slice(0, MAX_VISIBLE_RESULTS);
  for (let i = 0; i < visibleMatches.length; i++) {
    lines.push(formatRow(visibleMatches[i], i === state.selectedIndex, terminalWidth));
  }

  // Show if there are more results
  if (state.matches.length > MAX_VISIBLE_RESULTS) {
    const more = state.matches.length - MAX_VISIBLE_RESULTS;
    lines.push(`${DIM_GRAY}  ... and ${more} more${RESET}`);
  }

  // Footer hint
  lines.push(`${DIM_GRAY}↑↓ navigate • Tab select • Esc cancel${RESET}`);

  return lines;
}

// ============================================================
// Rendering
// ============================================================

/**
 * Render the dropdown below current cursor position
 * Returns the ANSI string to output
 *
 * Uses relative cursor movement to handle terminal scrolling correctly:
 * - \n creates lines (may scroll terminal)
 * - \x1b[NA moves cursor back up (relative, works after scroll)
 * - Does NOT use save/restore cursor (breaks on scroll)
 */
export function renderDropdown(state: MentionState, terminalWidth = 80): string {
  const lines = formatDropdown(state, terminalWidth);
  state.visibleLines = lines.length;

  if (lines.length === 0) {
    state.lastDropdownHeight = 0;
    return "";
  }

  let output = "";

  // Render each line below current position
  // Using \n ensures lines exist (may scroll terminal if at bottom)
  for (let i = 0; i < lines.length; i++) {
    output += "\n" + CARRIAGE_RETURN + CLEAR_LINE + lines[i];
  }

  // Move cursor back up using relative movement (works after scroll)
  output += CURSOR_UP(lines.length);

  state.lastDropdownHeight = lines.length;

  return output;
}

/**
 * Clear the dropdown from the screen
 * Returns the ANSI string to output
 *
 * Uses \x1b[B (cursor down) instead of \n because:
 * - Lines already exist from previous render
 * - \x1b[B doesn't create new lines or scroll
 */
export function clearDropdown(state: MentionState): string {
  if (state.lastDropdownHeight === 0) return "";

  let output = "";

  // Move down and clear each line using cursor movement (NOT \n!)
  // Lines already exist from renderDropdown, so \x1b[B is safe
  for (let i = 0; i < state.lastDropdownHeight; i++) {
    output += CURSOR_DOWN + CARRIAGE_RETURN + CLEAR_LINE;
  }

  // Move back up using relative movement
  output += CURSOR_UP(state.lastDropdownHeight);

  state.lastDropdownHeight = 0;

  return output;
}

// ============================================================
// State Management
// ============================================================

/**
 * Activate mention mode
 */
export function activateMention(state: MentionState, atPosition: number): void {
  state.active = true;
  state.query = "";
  state.atPosition = atPosition;
  state.matches = [];
  state.selectedIndex = 0;
}

/**
 * Deactivate mention mode
 */
export function deactivateMention(state: MentionState): void {
  state.active = false;
  state.query = "";
  state.matches = [];
  state.selectedIndex = 0;
}

/**
 * Update the search query and refresh results
 */
export async function updateQuery(state: MentionState, query: string): Promise<void> {
  state.query = query;
  state.matches = await searchFiles(query, MAX_VISIBLE_RESULTS + 5);
  state.selectedIndex = 0;
}

/**
 * Navigate selection up
 */
export function navigateUp(state: MentionState): void {
  if (state.matches.length === 0) return;

  const maxVisible = Math.min(state.matches.length, MAX_VISIBLE_RESULTS);
  state.selectedIndex = (state.selectedIndex - 1 + maxVisible) % maxVisible;
}

/**
 * Navigate selection down
 */
export function navigateDown(state: MentionState): void {
  if (state.matches.length === 0) return;

  const maxVisible = Math.min(state.matches.length, MAX_VISIBLE_RESULTS);
  state.selectedIndex = (state.selectedIndex + 1) % maxVisible;
}

/**
 * Get the currently selected match
 */
export function getSelectedMatch(state: MentionState): FileMatch | null {
  if (!state.active || state.matches.length === 0) return null;
  return state.matches[state.selectedIndex] ?? null;
}

/**
 * Get the text to insert when selection is confirmed
 * Returns @path format to keep the mention abstraction visible
 * The REPL can later resolve this to actual file content
 */
export function getInsertText(state: MentionState): string | null {
  const match = getSelectedMatch(state);
  if (!match) return null;

  // Return @path format (keeps the @ mention abstraction)
  return `@${match.path}`;
}
