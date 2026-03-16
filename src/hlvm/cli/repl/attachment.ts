/**
 * Attachment Manager
 *
 * Handles media attachments for the REPL:
 * - Read files and encode as base64
 * - Detect MIME types from file extension
 * - Generate display names ([Image #1], etc.)
 * - Validate file size limits
 */

import { encodeBase64 } from "@std/encoding/base64";
import {
  countLines,
  getErrorMessage,
  isFileNotFoundError,
} from "../../../common/utils.ts";
import { formatBytes } from "../../../common/limits.ts";
import { getPlatform } from "../../../platform/platform.ts";

// ============================================================================
// Types
// ============================================================================

export type AttachmentType =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "document"
  | "file"
  | "text";

export interface AttachmentMetadata {
  width?: number;
  height?: number;
  duration?: number;
  pages?: number;
}

export interface Attachment {
  id: number;
  type: AttachmentType;
  displayName: string;
  path: string;
  fileName: string;
  mimeType: string;
  base64Data: string;
  size: number;
  metadata?: AttachmentMetadata;
}

/** Text attachment for pasted text content */
export interface TextAttachment {
  id: number;
  type: "text";
  displayName: string;
  content: string;
  lineCount: number;
  size: number;
}

/** Union type for all attachment types (single source of truth) */
export type AnyAttachment = Attachment | TextAttachment;

export interface AttachmentError {
  type:
    | "not_found"
    | "permission_denied"
    | "size_exceeded"
    | "unsupported_type"
    | "read_error";
  message: string;
  path: string;
}

// ============================================================================
// Constants
// ============================================================================

/** File extension to MIME type mapping */
const EXT_TO_MIME: Record<string, string> = {
  // Images
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".ico": "image/x-icon",
  ".heic": "image/heic",
  ".heif": "image/heif",

  // Videos
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",

  // Audio
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".wma": "audio/x-ms-wma",

  // Documents
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",

  // Text documents
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".xml": "application/xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".yaml": "application/x-yaml",
  ".yml": "application/x-yaml",
};

/** MIME type to attachment type mapping (derived from EXT_TO_MIME — single source of truth) */
const MIME_TO_TYPE: Record<string, AttachmentType> = Object.fromEntries(
  Object.values(EXT_TO_MIME).map((mime) => {
    const prefix = mime.split("/")[0];
    const type: AttachmentType = mime === "application/pdf"
      ? "pdf"
      : prefix === "image"
      ? "image"
      : prefix === "video"
      ? "video"
      : prefix === "audio"
      ? "audio"
      : "document";
    return [mime, type];
  }),
);

/** Size limits per attachment type (in bytes) */
const SIZE_LIMITS: Record<AttachmentType, number> = {
  image: 20 * 1024 * 1024, // 20 MB
  video: 100 * 1024 * 1024, // 100 MB
  audio: 50 * 1024 * 1024, // 50 MB
  pdf: 50 * 1024 * 1024, // 50 MB
  document: 50 * 1024 * 1024, // 50 MB
  file: 10 * 1024 * 1024, // 10 MB (generic)
  text: 1 * 1024 * 1024, // 1 MB (pasted text)
};

/** Display name prefixes per type */
const TYPE_DISPLAY: Record<AttachmentType, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  pdf: "PDF",
  document: "Document",
  file: "File",
  text: "Pasted text",
};

export type ConversationAttachmentKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "text";

const CONVERSATION_TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "application/json",
  "application/xml",
  "text/html",
  "application/x-yaml",
]);

// ============================================================================
// Text Paste Detection Constants
// ============================================================================

/** Minimum number of lines to trigger text collapse */
const TEXT_COLLAPSE_MIN_LINES = 5;

/** Minimum character count to trigger text collapse */
const TEXT_COLLAPSE_MIN_CHARS = 300;

// ============================================================================
// Functions
// ============================================================================

/**
 * Conversation/agent media support is narrower than generic file-type detection.
 * Keep this as the SSOT for what HLVM can currently submit as multimodal input.
 */
export function isSupportedConversationMedia(path: string): boolean {
  const kind = getConversationAttachmentKind(
    getConversationAttachmentMimeType(path),
  );
  return kind !== null && kind !== "text";
}

/**
 * Get file extension from path (lowercase, with dot)
 */
function getExtension(path: string): string {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) return "";
  return path.slice(lastDot).toLowerCase();
}

/**
 * Get file name from path
 */
function getFileName(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}

/**
 * Detect MIME type from file extension
 */
export function detectMimeType(path: string): string {
  const ext = getExtension(path);
  return EXT_TO_MIME[ext] || "application/octet-stream";
}

function normalizeConversationAttachmentMimeType(
  mimeType: string,
): string {
  return CONVERSATION_TEXT_MIME_TYPES.has(mimeType) ? "text/plain" : mimeType;
}

export function getConversationAttachmentMimeType(path: string): string {
  return normalizeConversationAttachmentMimeType(detectMimeType(path));
}

export function getConversationAttachmentKind(
  mimeType: string,
): ConversationAttachmentKind | null {
  const normalizedMimeType = normalizeConversationAttachmentMimeType(mimeType);
  if (normalizedMimeType.startsWith("image/")) return "image";
  if (normalizedMimeType.startsWith("audio/")) return "audio";
  if (normalizedMimeType.startsWith("video/")) return "video";
  if (normalizedMimeType === "application/pdf") return "pdf";
  if (normalizedMimeType === "text/plain") return "text";
  return null;
}

/**
 * Get attachment type from MIME type
 */
export function getAttachmentType(mimeType: string): AttachmentType {
  return MIME_TO_TYPE[mimeType] || "file";
}

/**
 * Generate display name: [Image #1], [Video #2], etc.
 */
export function getDisplayName(type: AttachmentType, id: number): string {
  const prefix = TYPE_DISPLAY[type];
  return `[${prefix} #${id}]`;
}

/**
 * Get size limit for attachment type
 */
function getSizeLimit(type: AttachmentType): number {
  return SIZE_LIMITS[type];
}

/**
 * Create an attachment from a file path
 *
 * Reads the file, encodes as base64, detects MIME type, and creates attachment object.
 *
 * @param path - Absolute or relative file path
 * @param id - Sequential attachment ID
 * @returns Attachment object or error
 */
export async function createAttachment(
  path: string,
  id: number,
): Promise<Attachment | AttachmentError> {
  const platform = getPlatform();
  try {
    // Check if file exists and get info
    let fileInfo: { isFile: boolean; isDirectory: boolean; size: number };
    try {
      fileInfo = await platform.fs.stat(path);
    } catch (err) {
      if (isFileNotFoundError(err)) {
        return { type: "not_found", message: `File not found: ${path}`, path };
      }
      if (err instanceof Error && err.name === "PermissionDenied") {
        return {
          type: "permission_denied",
          message: `Permission denied: ${path}`,
          path,
        };
      }
      throw err;
    }

    // Check if it's a file (not directory)
    if (fileInfo.isDirectory) {
      return {
        type: "unsupported_type",
        message: `Cannot attach directory: ${path}`,
        path,
      };
    }

    // Detect MIME type
    const mimeType = detectMimeType(path);
    const attachmentType = getAttachmentType(mimeType);

    // Validate size
    const sizeLimit = getSizeLimit(attachmentType);
    if (fileInfo.size > sizeLimit) {
      return {
        type: "size_exceeded",
        message: `File too large: ${formatBytes(fileInfo.size)} exceeds ${
          formatBytes(sizeLimit)
        } limit`,
        path,
      };
    }

    // Read file and encode as base64
    const bytes = await platform.fs.readFile(path);
    const base64Data = encodeBase64(bytes);

    // Create attachment object
    const attachment: Attachment = {
      id,
      type: attachmentType,
      displayName: getDisplayName(attachmentType, id),
      path,
      fileName: getFileName(path),
      mimeType,
      base64Data,
      size: fileInfo.size,
    };

    return attachment;
  } catch (err) {
    return {
      type: "read_error",
      message: `Failed to read file: ${getErrorMessage(err)}`,
      path,
    };
  }
}

/**
 * Check if a result is an attachment (not an error)
 */
export function isAttachment(
  result: Attachment | AttachmentError,
): result is Attachment {
  return "id" in result && "base64Data" in result;
}

// ============================================================================
// Text Attachment Functions
// ============================================================================

/**
 * Check if pasted text should be collapsed
 * Returns true if text has multiple lines AND exceeds thresholds
 *
 * Key insight: Single lines should NEVER be collapsed, even if very long.
 * Terminal pastes often arrive line-by-line, so we need the newline check
 * to distinguish a genuine multi-line paste from sequential single lines.
 *
 * Note: Collapsed text is still executed properly - App.tsx expands
 * [Pasted text #N] placeholders to actual content before evaluation.
 */
export function shouldCollapseText(text: string): boolean {
  const lineCount = countLines(text);

  // CRITICAL: Must have actual newlines to be a "pasted text block"
  // Single lines (even if 1000+ chars) should be inserted directly
  if (lineCount < 2) {
    return false;
  }

  // Multi-line paste: collapse if enough lines OR enough total chars
  return lineCount >= TEXT_COLLAPSE_MIN_LINES ||
    text.length >= TEXT_COLLAPSE_MIN_CHARS;
}

/**
 * Generate display name for pasted text: [Pasted text #1 +183 lines]
 */
export function getTextDisplayName(id: number, lineCount: number): string {
  return `[Pasted text #${id} +${lineCount} lines]`;
}

/**
 * Create a text attachment from pasted content
 */
export function createTextAttachment(
  content: string,
  id: number,
): TextAttachment {
  const lineCount = countLines(content);
  const size = new TextEncoder().encode(content).length;

  return {
    id,
    type: "text",
    displayName: getTextDisplayName(id, lineCount),
    content,
    lineCount,
    size,
  };
}
