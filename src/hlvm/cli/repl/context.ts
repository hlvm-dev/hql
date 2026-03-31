/**
 * REPL Context Management - Pure Data Structures
 *
 * Provides three vectors accessible as programming data:
 * - pastes: vector of {id: ..., content: ..., lang: ..., lines: ..., chars: ..., time: ...}
 * - attachments: vector of {id: ..., attachmentId: ..., type: ..., name: ..., path: ..., mime: ..., size: ..., metadata?: ..., time: ...}
 * - conversation: vector of {role: ..., content: ..., time: ...}
 *
 * All vectors are accessible via globalThis and can be manipulated
 * with standard list operations (nth, filter, map, etc.)
 */

import { countLines } from "../../../common/utils.ts";
import type {
  AttachmentKind,
  AttachmentMetadata,
  AttachmentRecord,
  PreparedAttachment,
} from "../../attachments/types.ts";
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
 * Media attachment entry - attachment metadata exposed in REPL context
 */
export interface MediaAttachment {
  readonly id: number;
  readonly attachmentId: string;
  readonly type: AttachmentKind;
  readonly name: string;
  readonly path: string;
  readonly mime: string;
  readonly size: number;
  readonly metadata?: AttachmentMetadata;
  readonly time: number;
}

/**
 * Media object used by AI helpers (derived from attachments)
 */
interface HlvmMedia {
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
const attachmentMedia = new Map<number, HlvmMedia>();

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

// ============================================================================
// Attachment Operations
// ============================================================================

/**
 * Add an attachment metadata snapshot and optional prepared runtime media
 */
export function addAttachment(
  record: AttachmentRecord,
  prepared?: PreparedAttachment,
): MediaAttachment {
  const attachment: MediaAttachment = {
    id: attachments.length,
    attachmentId: record.id,
    type: record.kind,
    name: record.fileName,
    path: record.sourcePath ?? record.fileName,
    mime: record.mimeType,
    size: record.size,
    ...(record.metadata ? { metadata: record.metadata } : {}),
    time: Date.now(),
  };
  attachments.push(attachment);
  if (prepared) {
    const mediaType = toRuntimeMediaType(record.kind);
    if (mediaType) {
      attachmentMedia.set(attachment.id, {
        type: mediaType,
        mimeType: prepared.mimeType,
        data: prepared.data,
        source: record.sourcePath ?? record.fileName,
        __hlvm_media__: true,
      });
    }
  }
  syncToGlobal();
  return attachment;
}

/**
 * Get Media objects derived from attachments (base64 only)
 */
export function getMedia(): readonly HlvmMedia[] {
  return attachments
    .map((attachment) => attachmentMedia.get(attachment.id))
    .filter((media): media is HlvmMedia => media !== undefined);
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

// ============================================================================
// Context Management
// ============================================================================

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

function toRuntimeMediaType(
  kind: AttachmentKind,
): HlvmMedia["type"] | null {
  switch (kind) {
    case "image":
    case "audio":
    case "video":
      return kind;
    case "pdf":
    case "document":
      return "document";
    default:
      return null;
  }
}
