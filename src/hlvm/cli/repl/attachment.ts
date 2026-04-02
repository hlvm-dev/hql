/**
 * REPL attachment helpers.
 *
 * This layer manages composer-facing attachment refs and pasted text collapse,
 * while the canonical attachment bytes/metadata live in src/hlvm/attachments/.
 */

import { countLines, truncate } from "../../../common/utils.ts";
import { formatBytes } from "../../../common/limits.ts";
import {
  detectAttachmentMimeType,
  getAttachmentDisplayName,
  getAttachmentFileName,
  getAttachmentKind,
  getConversationAttachmentKind,
  getTextAttachmentDisplayName,
  isSupportedConversationAttachmentMimeType,
  normalizeConversationAttachmentMimeType,
} from "../../attachments/metadata.ts";
import {
  registerAttachmentFromPath,
  registerTextAttachment,
} from "../../attachments/service.ts";
import type {
  AttachmentKind as AttachmentType,
  AttachmentMetadata,
  AttachmentServiceErrorCode,
  ConversationAttachmentKind,
} from "../../attachments/types.ts";
import { AttachmentServiceError } from "../../attachments/types.ts";

export type { AttachmentMetadata, AttachmentType, ConversationAttachmentKind };

export interface Attachment {
  id: number;
  attachmentId: string;
  type: AttachmentType;
  displayName: string;
  path: string;
  fileName: string;
  mimeType: string;
  size: number;
  metadata?: AttachmentMetadata;
}

export interface TextAttachment {
  id: number;
  attachmentId: string;
  type: "text";
  displayName: string;
  content: string;
  lineCount: number;
  size: number;
  fileName: string;
  mimeType: string;
}

export type AnyAttachment = Attachment | TextAttachment;

export interface AttachmentError {
  type: AttachmentServiceErrorCode;
  message: string;
  path: string;
}

const TEXT_COLLAPSE_MIN_LINES = 5;
const TEXT_COLLAPSE_MIN_CHARS = 300;

export function isSupportedConversationMedia(path: string): boolean {
  return isSupportedConversationAttachmentMimeType(
    getConversationAttachmentMimeType(path),
  ) && getConversationAttachmentKind(getConversationAttachmentMimeType(path)) !==
    "text";
}

export function isSupportedConversationAttachmentPath(_path: string): boolean {
  return true;
}

export function detectMimeType(path: string): string {
  return detectAttachmentMimeType(path);
}

export function getConversationAttachmentMimeType(path: string): string {
  return normalizeConversationAttachmentMimeType(detectMimeType(path));
}

export {
  getConversationAttachmentKind,
  isSupportedConversationAttachmentMimeType,
};

export function getAttachmentType(mimeType: string): AttachmentType {
  return getAttachmentKind(mimeType);
}

export function getDisplayName(type: AttachmentType, id: number): string {
  return getAttachmentDisplayName(type, id);
}

function formatAttachmentError(
  error: AttachmentServiceError,
  filePath: string,
): AttachmentError {
  switch (error.code) {
    case "size_exceeded":
      return {
        type: error.code,
        message: error.message.replace(
          /Attachment too large: (\d+) bytes exceeds (\d+) byte limit\./,
          (_match, actual, limit) =>
            `File too large: ${formatBytes(Number(actual))} exceeds ${
              formatBytes(Number(limit))
            } limit`,
        ),
        path: filePath,
      };
    default:
      return {
        type: error.code,
        message: error.message,
        path: filePath,
      };
  }
}

export async function createAttachment(
  filePath: string,
  id: number,
): Promise<Attachment | AttachmentError> {
  try {
    const record = await registerAttachmentFromPath(filePath);
    return {
      id,
      attachmentId: record.id,
      type: record.kind,
      displayName: getDisplayName(record.kind, id),
      path: record.sourcePath ?? filePath,
      fileName: record.fileName || getAttachmentFileName(filePath),
      mimeType: record.mimeType,
      size: record.size,
      metadata: record.metadata,
    };
  } catch (error) {
    if (error instanceof AttachmentServiceError) {
      return formatAttachmentError(error, filePath);
    }
    return {
      type: "read_error",
      message: error instanceof Error ? error.message : "Failed to read file",
      path: filePath,
    };
  }
}

export function isAttachment(
  result: Attachment | AttachmentError,
): result is Attachment {
  return "attachmentId" in result;
}

export function shouldCollapseText(text: string): boolean {
  const lineCount = countLines(text);
  if (lineCount < 2) {
    return false;
  }
  return lineCount >= TEXT_COLLAPSE_MIN_LINES ||
    text.length >= TEXT_COLLAPSE_MIN_CHARS;
}

export function getTextDisplayName(id: number, lineCount: number): string {
  return getTextAttachmentDisplayName(id, lineCount);
}

function buildPastedTextPreview(content: string): string {
  const flattened = content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  if (!flattened) return "";
  if (flattened.length <= 48) {
    return flattened;
  }
  const head = flattened.slice(0, 28).trimEnd();
  const tail = flattened.slice(-16).trimStart();
  return `${head} ... ${tail}`;
}

export function getPastedTextPreviewLabel(
  id: number,
  content: string,
  lineCount = countLines(content),
): string {
  const preview = buildPastedTextPreview(content);
  const lineSuffix = lineCount > 1 ? ` +${lineCount} lines` : "";
  if (!preview) {
    return getTextDisplayName(id, lineCount);
  }
  return truncate(
    `[Pasted text #${id}: ${preview}${lineSuffix}]`,
    96,
  );
}

export async function createTextAttachment(
  content: string,
  id: number,
): Promise<TextAttachment | AttachmentError> {
  const lineCount = countLines(content);
  try {
    const record = await registerTextAttachment(content, `pasted-text-${id}.txt`);
    return {
      id,
      attachmentId: record.id,
      type: "text",
      displayName: getPastedTextPreviewLabel(id, content, lineCount),
      content,
      lineCount,
      size: record.size,
      fileName: record.fileName,
      mimeType: record.mimeType,
    };
  } catch (error) {
    if (error instanceof AttachmentServiceError) {
      return formatAttachmentError(error, "[pasted text]");
    }
    return {
      type: "read_error",
      message: error instanceof Error ? error.message : "Failed to register pasted text",
      path: "[pasted text]",
    };
  }
}
