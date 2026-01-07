/**
 * Attachment Protocol (Backend Abstraction)
 *
 * Defines the interface for sending attachments to AI backends.
 * Implementations can be swapped without changing frontend code.
 *
 * This file provides:
 * 1. Content block types (compatible with Anthropic/OpenAI API structures)
 * 2. Backend protocol interface for implementing providers
 * 3. Helper functions for converting attachments to content blocks
 */

import type { Attachment, AttachmentType } from "./attachment.ts";

// ============================================================================
// Content Block Types (API Format)
// ============================================================================

/**
 * Text content block
 */
export interface TextContent {
  type: "text";
  text: string;
}

/**
 * Image content block (Anthropic format)
 */
export interface ImageContent {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

/**
 * Document content block (PDF, etc.)
 */
export interface DocumentContent {
  type: "document";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

/**
 * File content block (generic binary)
 */
export interface FileContent {
  type: "file";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
  file_name?: string;
}

/**
 * All possible content block types
 */
export type ContentBlock = TextContent | ImageContent | DocumentContent | FileContent;

// ============================================================================
// Backend Protocol Interface
// ============================================================================

/**
 * Backend protocol interface for AI providers
 *
 * Implementations:
 * - AnthropicBackend: For Claude API
 * - OpenAIBackend: For GPT-4 Vision
 * - OllamaBackend: For local Ollama models (llava, etc.)
 */
export interface AttachmentBackend {
  /** Backend identifier */
  name: string;

  /** Check if this backend supports a specific attachment type */
  supportsType(type: AttachmentType): boolean;

  /** Get list of supported MIME types */
  supportedMimeTypes(): string[];

  /**
   * Format attachments + text for API call
   * Returns the formatted message structure expected by this backend
   */
  formatForApi(attachments: Attachment[], text: string): unknown;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert a single attachment to a content block
 */
export function attachmentToContentBlock(attachment: Attachment): ContentBlock {
  switch (attachment.type) {
    case "image":
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: attachment.mimeType,
          data: attachment.base64Data,
        },
      };

    case "document":
      return {
        type: "document",
        source: {
          type: "base64",
          media_type: attachment.mimeType,
          data: attachment.base64Data,
        },
      };

    case "video":
    case "audio":
    case "file":
    default:
      return {
        type: "file",
        source: {
          type: "base64",
          media_type: attachment.mimeType,
          data: attachment.base64Data,
        },
        file_name: attachment.fileName,
      };
  }
}

/**
 * Convert attachments + text to array of content blocks
 *
 * Text references to attachments (like [Image #1]) are kept in the text.
 * The content blocks provide the actual binary data.
 *
 * Order: attachments first, then text (this is Claude's preferred order)
 */
export function attachmentsToContentBlocks(
  text: string,
  attachments: Attachment[]
): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  // Add attachment blocks first
  for (const attachment of attachments) {
    blocks.push(attachmentToContentBlock(attachment));
  }

  // Add text block last
  if (text.trim()) {
    blocks.push({
      type: "text",
      text: text,
    });
  }

  return blocks;
}

/**
 * Replace attachment placeholders in text with descriptions
 *
 * Transforms: "[Image #1] What's in this?"
 * To: "<image 1: screenshot.png> What's in this?"
 *
 * Useful for backends that don't support multimodal content
 */
export function replaceAttachmentPlaceholders(
  text: string,
  attachments: Attachment[]
): string {
  let result = text;

  for (const attachment of attachments) {
    // Match [Image #1], [PDF #2], etc.
    const placeholder = attachment.displayName;
    const description = `<${attachment.type} ${attachment.id}: ${attachment.fileName}>`;
    result = result.replace(placeholder, description);
  }

  return result;
}

// ============================================================================
// Stub Backend Implementation (for testing)
// ============================================================================

/**
 * Stub backend that logs attachments (for development/testing)
 */
export class StubBackend implements AttachmentBackend {
  name = "stub";

  supportsType(_type: AttachmentType): boolean {
    return true; // Accept all types
  }

  supportedMimeTypes(): string[] {
    return ["*/*"]; // Accept all
  }

  formatForApi(attachments: Attachment[], text: string): unknown {
    // Just return a structured object for inspection
    return {
      backend: "stub",
      text,
      attachments: attachments.map((a) => ({
        id: a.id,
        type: a.type,
        displayName: a.displayName,
        fileName: a.fileName,
        mimeType: a.mimeType,
        size: a.size,
        // Don't include base64Data in logs - too large
        hasData: !!a.base64Data,
      })),
      contentBlocks: attachmentsToContentBlocks(text, attachments).map((block) => {
        if (block.type === "text") return block;
        // Truncate base64 data in logs
        return {
          ...block,
          source: {
            ...("source" in block ? block.source : {}),
            data: "[base64 data truncated]",
          },
        };
      }),
    };
  }
}

// ============================================================================
// Backend Registry (for future use)
// ============================================================================

const backends = new Map<string, AttachmentBackend>();

/**
 * Register a backend implementation
 */
export function registerBackend(backend: AttachmentBackend): void {
  backends.set(backend.name, backend);
}

/**
 * Get a registered backend by name
 */
export function getBackend(name: string): AttachmentBackend | undefined {
  return backends.get(name);
}

/**
 * Get all registered backends
 */
export function getAllBackends(): AttachmentBackend[] {
  return Array.from(backends.values());
}

// Register stub backend by default
registerBackend(new StubBackend());
