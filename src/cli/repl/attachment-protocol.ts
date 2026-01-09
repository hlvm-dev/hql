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

import type { Attachment, TextAttachment, AttachmentType, AnyAttachment } from "./attachment.ts";

// Re-export AnyAttachment for consumers (single source of truth is attachment.ts)
export type { AnyAttachment };

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
 * Pasted text content block (for collapsed text pastes)
 */
export interface PastedTextContent {
  type: "pasted_text";
  text: string;
  line_count: number;
}

/**
 * All possible content block types
 */
export type ContentBlock = TextContent | ImageContent | DocumentContent | FileContent | PastedTextContent;

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
  formatForApi(attachments: AnyAttachment[], text: string): unknown;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if attachment is a text attachment
 */
function isTextAttachment(attachment: AnyAttachment): attachment is TextAttachment {
  return attachment.type === "text" && "content" in attachment;
}

/**
 * Convert a single attachment to a content block (internal helper)
 */
function attachmentToContentBlock(attachment: AnyAttachment): ContentBlock {
  // Handle text attachments (pasted text)
  if (isTextAttachment(attachment)) {
    return {
      type: "pasted_text",
      text: attachment.content,
      line_count: attachment.lineCount,
    };
  }

  // Handle media attachments
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
  attachments: AnyAttachment[]
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
