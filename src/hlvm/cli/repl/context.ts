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

// ============================================================================
// Language Detection (Simple heuristic)
// ============================================================================

/**
 * Detect programming language from content
 */
export function detectLanguage(content: string): string {
  const sample = content.slice(0, 1000);

  // HQL/Lisp
  if (/^\s*\((?:def|fn|defn|let|if|cond|do|ns|import|require)\s/m.test(sample)) {
    return "hql";
  }
  if (/^\s*;.*$/m.test(sample) && /\(/.test(sample)) {
    return "lisp";
  }

  // TypeScript
  if (
    /:\s*(?:string|number|boolean|any|void|never)\b/.test(sample) ||
    /interface\s+\w+\s*\{/.test(sample) ||
    /type\s+\w+\s*=/.test(sample)
  ) {
    return "typescript";
  }

  // JavaScript
  if (
    /(?:const|let|var)\s+\w+\s*=/.test(sample) ||
    /function\s+\w+\s*\(/.test(sample) ||
    /=>\s*\{/.test(sample)
  ) {
    return "javascript";
  }

  // Python
  if (/^(?:def|class|import|from)\s/m.test(sample) || /:\s*$/m.test(sample)) {
    return "python";
  }

  // Rust
  if (/(?:fn|let\s+mut|impl|struct|enum|pub\s+fn)/.test(sample)) {
    return "rust";
  }

  // Go
  if (/^package\s+\w+$/m.test(sample) || /func\s+\w+\s*\(/.test(sample)) {
    return "go";
  }

  // SQL
  if (/^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s/im.test(sample)) {
    return "sql";
  }

  // JSON
  if (/^\s*[\{\[]/.test(sample)) {
    try {
      JSON.parse(content);
      return "json";
    } catch {
      // Not valid JSON
    }
  }

  // YAML
  if (/^[\w-]+:\s/m.test(sample) && !/{/.test(sample)) {
    return "yaml";
  }

  // HTML
  if (/<(!DOCTYPE|html|head|body|div|span|p)\b/i.test(sample)) {
    return "html";
  }

  // CSS
  if (/[.#][\w-]+\s*\{/.test(sample) || /@media|@import/.test(sample)) {
    return "css";
  }

  // Markdown
  if (/^#{1,6}\s/.test(sample) || /^\s*[-*+]\s/.test(sample)) {
    return "markdown";
  }

  // Shell
  if (/^#!/.test(sample) || /\$\(|&&|\|\|/.test(sample)) {
    return "shell";
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
    lines: content.split(/\r?\n|\r/).length,
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
  return pastes.find((p) => p.id === id);
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
  base64Data?: string
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
  return attachments.find((a) => a.id === id);
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
  content: string
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
