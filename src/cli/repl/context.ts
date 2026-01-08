/**
 * REPL Context Management
 *
 * Provides:
 * 1. paste-N variables for pasted text attachments
 * 2. Conversation context tracking (last-input, last-response, conversation)
 * 3. Syntax transformation for [Pasted text #N] → paste-N
 */

import type { TextAttachment } from "./attachment.ts";
import type { AnyAttachment } from "./attachment-protocol.ts";
import { escapeString, getGlobalRecord } from "./string-utils.ts";

// ============================================================================
// Types
// ============================================================================

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ReplContext {
  /** Paste variables: paste-1, paste-2, etc. */
  pastes: Map<number, string>;

  /** Last user input */
  lastInput: string;

  /** Last assistant response */
  lastResponse: string;

  /** Full conversation history */
  conversation: ConversationTurn[];
}

// ============================================================================
// Global Context (singleton)
// ============================================================================

let context: ReplContext = {
  pastes: new Map(),
  lastInput: "",
  lastResponse: "",
  conversation: [],
};

/**
 * Get the current REPL context
 */
export function getContext(): ReplContext {
  return context;
}

/**
 * Reset the context (for testing or REPL reset)
 */
export function resetContext(): void {
  context = {
    pastes: new Map(),
    lastInput: "",
    lastResponse: "",
    conversation: [],
  };
  // Also clear from globalThis
  const g = getGlobalRecord();
  delete g["last-input"];
  delete g["last_input"];
  delete g["last-response"];
  delete g["last_response"];
  delete g["conversation"];
  // Clear paste variables
  for (let i = 1; i <= 100; i++) {
    delete g[`paste-${i}`];
    delete g[`paste_${i}`];
  }
}

// ============================================================================
// Paste Variables
// ============================================================================

/**
 * Register a text attachment as a paste variable
 * Makes paste-N available in the REPL
 */
export function registerPaste(attachment: TextAttachment): void {
  context.pastes.set(attachment.id, attachment.content);
  // Also set on globalThis for immediate access
  const g = getGlobalRecord();
  g[`paste-${attachment.id}`] = attachment.content;
  g[`paste_${attachment.id}`] = attachment.content; // Also snake_case version
}

/**
 * Register multiple attachments (filters for text attachments only)
 */
export function registerAttachments(attachments: AnyAttachment[]): void {
  for (const att of attachments) {
    if (att.type === "text" && "content" in att) {
      registerPaste(att as TextAttachment);
    }
  }
}

/**
 * Get a paste by ID
 */
export function getPaste(id: number): string | undefined {
  return context.pastes.get(id);
}

/**
 * Get all paste IDs
 */
export function getPasteIds(): number[] {
  return Array.from(context.pastes.keys());
}

// ============================================================================
// Conversation Context
// ============================================================================

/**
 * Record user input
 */
export function recordUserInput(input: string): void {
  context.lastInput = input;
  context.conversation.push({
    role: "user",
    content: input,
    timestamp: Date.now(),
  });
  // Update globalThis
  const g = getGlobalRecord();
  g["last-input"] = input;
  g["last_input"] = input;
  updateConversationGlobal();
}

/**
 * Record assistant response
 */
export function recordAssistantResponse(response: string): void {
  context.lastResponse = response;
  context.conversation.push({
    role: "assistant",
    content: response,
    timestamp: Date.now(),
  });
  // Update globalThis
  const g = getGlobalRecord();
  g["last-response"] = response;
  g["last_response"] = response;
  updateConversationGlobal();
}

/**
 * Update the conversation global variable
 */
function updateConversationGlobal(): void {
  const g = getGlobalRecord();
  // Store as formatted string for easy use in HQL
  g["conversation"] = formatConversation();
}

/**
 * Format conversation history as a readable string
 */
export function formatConversation(): string {
  return context.conversation
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`)
    .join("\n\n");
}

/**
 * Get conversation history as array
 */
export function getConversation(): ConversationTurn[] {
  return [...context.conversation];
}

// ============================================================================
// Syntax Transformation
// ============================================================================

/**
 * Transform [Pasted text #N +X lines] references to paste-N variable names
 *
 * Examples:
 *   "(ask [Pasted text #1 +245 lines])" → "(ask paste-1)"
 *   "[Pasted text #2 +10 lines] [Pasted text #3 +5 lines]" → "paste-2 paste-3"
 */
export function transformPasteReferences(code: string): string {
  // Match [Pasted text #N +X lines] or [Pasted text #N]
  const pasteRegex = /\[Pasted text #(\d+)(?:\s+\+\d+\s+lines?)?\]/gi;

  return code.replace(pasteRegex, (_match, id) => {
    return `paste-${id}`;
  });
}

/**
 * Transform context variable references
 *
 * Examples:
 *   "[last-response]" → "last-response"
 *   "[conversation]" → "conversation"
 *   "[last-input]" → "last-input"
 */
export function transformContextReferences(code: string): string {
  // Match [last-response], [last-input], [conversation]
  const contextRegex = /\[(last-response|last-input|last_response|last_input|conversation)\]/gi;

  return code.replace(contextRegex, (_match, name) => {
    return name.toLowerCase().replace("_", "-");
  });
}

/**
 * Full preprocessing: transform all special references
 */
export function preprocessCode(code: string): string {
  let result = code;
  result = transformPasteReferences(result);
  result = transformContextReferences(result);
  return result;
}

// ============================================================================
// HQL Code Generation
// ============================================================================

/**
 * Generate HQL binding statements for all registered pastes
 * These define paste-N as string variables in the HQL environment
 *
 * @returns HQL code that defines all paste variables
 */
export function generatePasteBindings(): string {
  const bindings: string[] = [];

  for (const [id, content] of context.pastes) {
    // Escape the content for HQL string literal
    const escaped = escapeString(content);
    bindings.push(`(def paste-${id} "${escaped}")`);
  }

  return bindings.join("\n");
}

/**
 * Generate HQL binding statements for context variables
 */
export function generateContextBindings(): string {
  const bindings: string[] = [];

  if (context.lastInput) {
    bindings.push(`(def last-input "${escapeString(context.lastInput)}")`);
  }

  if (context.lastResponse) {
    bindings.push(`(def last-response "${escapeString(context.lastResponse)}")`);
  }

  if (context.conversation.length > 0) {
    bindings.push(`(def conversation "${escapeString(formatConversation())}")`);
  }

  return bindings.join("\n");
}

/**
 * Escape a string for use in HQL string literal.
 * Alias for escapeString to maintain backward compatibility with tests.
 */
export const escapeHqlString = escapeString;

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize context bindings on globalThis
 * Call this at REPL startup
 */
export function initializeContextGlobals(): void {
  const g = getGlobalRecord();

  // Initialize with empty values
  g["last-input"] = "";
  g["last_input"] = "";
  g["last-response"] = "";
  g["last_response"] = "";
  g["conversation"] = "";
}

// Initialize on module load
initializeContextGlobals();
