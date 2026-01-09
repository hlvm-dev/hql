/**
 * Attachment Manager
 *
 * Handles media attachments for the REPL:
 * - Read files and encode as base64
 * - Detect MIME types from file extension
 * - Generate display names ([Image #1], etc.)
 * - Validate file size limits
 */

import { encodeBase64 } from "jsr:@std/encoding@1/base64";

// ============================================================================
// Types
// ============================================================================

export type AttachmentType = "image" | "video" | "audio" | "document" | "file" | "text";

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
  type: "not_found" | "permission_denied" | "size_exceeded" | "unsupported_type" | "read_error";
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
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** MIME type to attachment type mapping */
const MIME_TO_TYPE: Record<string, AttachmentType> = {
  // Images
  "image/jpeg": "image",
  "image/png": "image",
  "image/gif": "image",
  "image/webp": "image",
  "image/svg+xml": "image",
  "image/bmp": "image",
  "image/tiff": "image",
  "image/x-icon": "image",
  "image/heic": "image",
  "image/heif": "image",

  // Videos
  "video/mp4": "video",
  "video/webm": "video",
  "video/quicktime": "video",
  "video/x-msvideo": "video",
  "video/x-matroska": "video",
  "video/mpeg": "video",

  // Audio
  "audio/mpeg": "audio",
  "audio/wav": "audio",
  "audio/ogg": "audio",
  "audio/flac": "audio",
  "audio/aac": "audio",
  "audio/mp4": "audio",
  "audio/x-ms-wma": "audio",

  // Documents
  "application/pdf": "document",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.ms-excel": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
  "application/vnd.ms-powerpoint": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
};

/** Size limits per attachment type (in bytes) */
const SIZE_LIMITS: Record<AttachmentType, number> = {
  image: 20 * 1024 * 1024,     // 20 MB
  video: 100 * 1024 * 1024,    // 100 MB
  audio: 50 * 1024 * 1024,     // 50 MB
  document: 50 * 1024 * 1024,  // 50 MB
  file: 10 * 1024 * 1024,      // 10 MB (generic)
  text: 1 * 1024 * 1024,       // 1 MB (pasted text)
};

/** Display name prefixes per type */
const TYPE_DISPLAY: Record<AttachmentType, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  document: "PDF",
  file: "File",
  text: "Pasted text",
};

// ============================================================================
// Text Paste Detection Constants
// ============================================================================

/** Minimum number of lines to trigger text collapse */
export const TEXT_COLLAPSE_MIN_LINES = 5;

/** Minimum character count to trigger text collapse */
export const TEXT_COLLAPSE_MIN_CHARS = 300;

/** Pre-compiled newline detection (handles \n, \r\n, \r) */
const NEWLINE_SPLIT_REGEX = /\r?\n|\r/;

/** Supported media file extensions (for quick check) */
const MEDIA_EXTENSIONS = new Set(Object.keys(EXT_TO_MIME));

// ============================================================================
// Functions
// ============================================================================

/**
 * Check if a file path is a supported media file
 */
export function isSupportedMedia(path: string): boolean {
  const ext = getExtension(path);
  return MEDIA_EXTENSIONS.has(ext);
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
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Get size limit for attachment type
 */
export function getSizeLimit(type: AttachmentType): number {
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
  id: number
): Promise<Attachment | AttachmentError> {
  try {
    // Check if file exists and get info
    let fileInfo: Deno.FileInfo;
    try {
      fileInfo = await Deno.stat(path);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        return { type: "not_found", message: `File not found: ${path}`, path };
      }
      if (err instanceof Deno.errors.PermissionDenied) {
        return { type: "permission_denied", message: `Permission denied: ${path}`, path };
      }
      throw err;
    }

    // Check if it's a file (not directory)
    if (fileInfo.isDirectory) {
      return { type: "unsupported_type", message: `Cannot attach directory: ${path}`, path };
    }

    // Detect MIME type
    const mimeType = detectMimeType(path);
    const attachmentType = getAttachmentType(mimeType);

    // Validate size
    const sizeLimit = getSizeLimit(attachmentType);
    if (fileInfo.size > sizeLimit) {
      return {
        type: "size_exceeded",
        message: `File too large: ${formatFileSize(fileInfo.size)} exceeds ${formatFileSize(sizeLimit)} limit`,
        path,
      };
    }

    // Read file and encode as base64
    const bytes = await Deno.readFile(path);
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
      message: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
      path,
    };
  }
}

/**
 * Check if a result is an attachment (not an error)
 */
export function isAttachment(result: Attachment | AttachmentError): result is Attachment {
  return "id" in result && "base64Data" in result;
}

/**
 * Check if a result is an error
 */
export function isAttachmentError(result: Attachment | AttachmentError): result is AttachmentError {
  return "type" in result && "message" in result && !("id" in result);
}

/**
 * Format attachment for inline display in input
 * Example: "[Image #1: screenshot.png (1.2 MB)]"
 */
export function formatAttachmentDetail(attachment: Attachment): string {
  const size = formatFileSize(attachment.size);
  return `[${TYPE_DISPLAY[attachment.type]} #${attachment.id}: ${attachment.fileName} (${size})]`;
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
 */
export function shouldCollapseText(text: string): boolean {
  // Handle all newline formats: \n (Unix), \r\n (Windows), \r (old Mac)
  const lineCount = text.split(NEWLINE_SPLIT_REGEX).length;

  // CRITICAL: Must have actual newlines to be a "pasted text block"
  // Single lines (even if 1000+ chars) should be inserted directly
  if (lineCount < 2) {
    return false;
  }

  // Multi-line paste: collapse if enough lines OR enough total chars
  return lineCount >= TEXT_COLLAPSE_MIN_LINES || text.length >= TEXT_COLLAPSE_MIN_CHARS;
}

/**
 * Count lines handling all newline formats
 */
export function countLines(text: string): number {
  return text.split(NEWLINE_SPLIT_REGEX).length;
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
export function createTextAttachment(content: string, id: number): TextAttachment {
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

/**
 * Get a preview of text attachment content
 */
export function getTextAttachmentPreview(attachment: TextAttachment, maxLines = 5): string {
  const lines = attachment.content.split(NEWLINE_SPLIT_REGEX);
  const preview = lines.slice(0, maxLines).join("\n");
  const remaining = lines.length - maxLines;
  return remaining > 0 ? `${preview}\n... +${remaining} more lines` : preview;
}

/**
 * Check if a result is a text attachment
 */
export function isTextAttachment(result: Attachment | TextAttachment | AttachmentError): result is TextAttachment {
  return "type" in result && result.type === "text" && "content" in result;
}
