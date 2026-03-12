/**
 * REPL Context Management - Pure Data Structures
 *
 * Provides three vectors accessible as programming data:
 * - pastes: vector of {id: ..., content: ..., lang: ..., lines: ..., chars: ..., time: ...}
 * - attachments: vector of {id: ..., type: ..., name: ..., path: ..., mime: ..., size: ..., time: ...}
 * - conversation: vector of {role: ..., content: ..., time: ...}
 *
 * All vectors are accessible via globalThis and can be manipulated
 * with standard list operations (nth, filter, map, etc.)
 */

import { countLines } from "../../../common/utils.ts";
import { getGlobalRecord } from "./string-utils.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Paste entry - text content with metadata
 */
export interface Paste {
  readonly id: number;
  readonly content: string;
  readonly lang: string;
  readonly lines: number;
  readonly chars: number;
  readonly time: number;
}

/**
 * Media attachment entry - binary file metadata with optional base64 data
 */
export interface MediaAttachment {
  readonly id: number;
  readonly type: string; // "image" | "video" | "audio" | "document" | "file"
  readonly name: string;
  readonly path: string;
  readonly mime: string;
  readonly size: number;
  readonly time: number;
  readonly base64Data?: string; // Base64-encoded content for AI functions
}

/**
 * Media object used by AI helpers (derived from attachments)
 */
export interface HlvmMedia {
  readonly type: string;
  readonly mimeType: string;
  readonly data: string;
  readonly source: string;
  readonly __hlvm_media__: true;
}

/**
 * Conversation turn entry
 */
export interface ConversationTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly time: number;
}

// ============================================================================
// State (Module-level arrays)
// ============================================================================

let pastes: Paste[] = [];
let attachments: MediaAttachment[] = [];
let conversation: ConversationTurn[] = [];

function getBySequentialId<T extends { readonly id: number }>(
  items: readonly T[],
  id: number,
): T | undefined {
  const item = items[id];
  return item?.id === id ? item : undefined;
}

// ============================================================================
// Language Detection (Simple heuristic)
// ============================================================================

// Pre-compiled detection patterns (avoid recompilation per call)
const LANG_PATTERNS: ReadonlyArray<readonly [RegExp, string, RegExp?]> = [
  [/^\s*\((?:def|fn|defn|let|if|cond|do|ns|import|require)\s/m, "hql"],
  [/^\s*;.*$/m, "lisp", /\(/],
  [/:\s*(?:string|number|boolean|any|void|never)\b/, "typescript"],
  [/interface\s+\w+\s*\{/, "typescript"],
  [/type\s+\w+\s*=/, "typescript"],
  [/(?:const|let|var)\s+\w+\s*=/, "javascript"],
  [/function\s+\w+\s*\(/, "javascript"],
  [/=>\s*\{/, "javascript"],
  [/^(?:def|class|import|from)\s/m, "python"],
  [/:\s*$/m, "python"],
  [/(?:fn|let\s+mut|impl|struct|enum|pub\s+fn)/, "rust"],
  [/^package\s+\w+$/m, "go"],
  [/func\s+\w+\s*\(/, "go"],
  [/^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s/im, "sql"],
  [/<(!DOCTYPE|html|head|body|div|span|p)\b/i, "html"],
  [/[.#][\w-]+\s*\{/, "css"],
  [/@media|@import/, "css"],
  [/^#{1,6}\s/, "markdown"],
  [/^\s*[-*+]\s/, "markdown"],
  [/^#!/, "shell"],
  [/\$\(|&&|\|\|/, "shell"],
];

const JSON_START_REGEX = /^\s*[\{\[]/;
const YAML_REGEX = /^[\w-]+:\s/m;
const YAML_EXCLUDE_REGEX = /\{/;

/**
 * Detect programming language from content
 */
function detectLanguage(content: string): string {
  const sample = content.slice(0, 1000);

  for (const [pattern, lang, extra] of LANG_PATTERNS) {
    if (pattern.test(sample) && (!extra || extra.test(sample))) {
      return lang;
    }
  }

  // JSON (requires parsing validation)
  if (JSON_START_REGEX.test(sample)) {
    try {
      JSON.parse(content);
      return "json";
    } catch {
      // Not valid JSON
    }
  }

  // YAML (requires exclusion check)
  if (YAML_REGEX.test(sample) && !YAML_EXCLUDE_REGEX.test(sample)) {
    return "yaml";
  }

  return "unknown";
}

// ============================================================================
// Paste Operations
// ============================================================================

/**
 * Add a paste and return the created entry
 */
export function addPaste(content: string, lang?: string): Paste {
  const paste: Paste = {
    id: pastes.length,
    content,
    lang: lang ?? detectLanguage(content),
    lines: countLines(content),
    chars: content.length,
    time: Date.now(),
  };
  pastes.push(paste);
  syncToGlobal();
  return paste;
}

/**
 * Get all pastes
 */
export function getPastes(): readonly Paste[] {
  return pastes;
}

/**
 * Get paste by ID
 */
export function getPaste(id: number): Paste | undefined {
  return getBySequentialId(pastes, id);
}

// ============================================================================
// Attachment Operations
// ============================================================================

/**
 * Add a media attachment and return the created entry
 * @param base64Data - Optional base64-encoded content for AI vision support
 */
export function addAttachment(
  type: string,
  name: string,
  path: string,
  mime: string,
  size: number,
  base64Data?: string,
): MediaAttachment {
  const attachment: MediaAttachment = {
    id: attachments.length,
    type,
    name,
    path,
    mime,
    size,
    time: Date.now(),
    base64Data,
  };
  attachments.push(attachment);
  syncToGlobal();
  return attachment;
}

/**
 * Get all attachments
 */
export function getAttachments(): readonly MediaAttachment[] {
  return attachments;
}

/**
 * Get attachment by ID
 */
export function getAttachment(id: number): MediaAttachment | undefined {
  return getBySequentialId(attachments, id);
}

/**
 * Get Media objects derived from attachments (base64 only)
 */
export function getMedia(): readonly HlvmMedia[] {
  return attachments
    .filter((a) => a.base64Data)
    .map((a) => ({
      type: a.type,
      mimeType: a.mime,
      data: a.base64Data as string,
      source: a.path,
      __hlvm_media__: true,
    }));
}

// ============================================================================
// Conversation Operations
// ============================================================================

/**
 * Add a conversation turn
 */
export function addConversationTurn(
  role: "user" | "assistant",
  content: string,
): ConversationTurn {
  const turn: ConversationTurn = {
    role,
    content,
    time: Date.now(),
  };
  conversation.push(turn);
  syncToGlobal();
  return turn;
}

/**
 * Get all conversation turns
 */
export function getConversation(): readonly ConversationTurn[] {
  return conversation;
}

// ============================================================================
// Context Management
// ============================================================================

/**
 * Reset all context (for testing or REPL reset)
 */
export function resetContext(): void {
  pastes = [];
  attachments = [];
  conversation = [];
  syncToGlobal();
}

/**
 * Sync arrays to globalThis for HQL access
 */
function syncToGlobal(): void {
  const g = getGlobalRecord();
  g["pastes"] = pastes;
  g["attachments"] = attachments;
  g["conversation"] = conversation;
}

/**
 * Initialize context on globalThis
 * Call this at REPL startup via initializeRuntime()
 */
export function initContext(): void {
  syncToGlobal();
}
