/**
 * REPL attachment helpers.
 *
 * This layer manages composer-facing attachment refs and pasted text collapse,
 * while the canonical attachment bytes/metadata live in src/hlvm/attachments/.
 */

import { countLines } from "../../../common/utils.ts";
import { formatBytes } from "../../../common/limits.ts";
import { getPlatform } from "../../../platform/platform.ts";
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

export interface AttachmentReferenceMatch {
  id: number;
  kind: "text" | "attachment";
  match: string;
  index: number;
}

const TEXT_COLLAPSE_MIN_LINES = 5;
const TEXT_COLLAPSE_MIN_CHARS = 300;
const TEXT_ATTACHMENT_REFERENCE_PATTERN =
  /\[(?:Pasted text|Text) #(\d+)(?:: [^\]]*)?(?: \+\d+ lines)?\]/g;
const BINARY_ATTACHMENT_REFERENCE_PATTERN =
  /\[(Image|Video|Audio|PDF|Document|File) #(\d+)\]/g;

function resolveAttachmentPath(path: string): string {
  const platform = getPlatform();
  const trimmed = path.trim();
  if (trimmed.startsWith("~")) {
    const home = platform.env.get("HOME");
    if (!home) return platform.path.normalize(trimmed);
    const suffix = trimmed.slice(1).replace(/^[/\\]+/, "");
    return suffix.length > 0
      ? platform.path.join(home, suffix)
      : home;
  }
  return platform.path.normalize(trimmed);
}

export function isSupportedConversationMedia(path: string): boolean {
  return isSupportedConversationAttachmentMimeType(
    getConversationAttachmentMimeType(path),
  ) && getConversationAttachmentKind(getConversationAttachmentMimeType(path)) !==
    "text";
}

export function isSupportedConversationAttachmentPath(path: string): boolean {
  return getConversationAttachmentKind(getConversationAttachmentMimeType(path)) !==
    null;
}

export function isAutoAttachableConversationAttachmentPath(path: string): boolean {
  const resolvedPath = resolveAttachmentPath(path);
  if (!isSupportedConversationMedia(resolvedPath)) {
    return false;
  }
  try {
    return getPlatform().fs.statSync(resolvedPath).isFile;
  } catch {
    return false;
  }
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
  return type === "text"
    ? getTextDisplayName(id, 0)
    : getAttachmentDisplayName(type, id);
}

function normalizeTextAttachmentDisplayName(
  attachment: Pick<AnyAttachment, "id" | "displayName"> &
    Partial<Pick<TextAttachment, "lineCount">>,
): string {
  return attachment.displayName.startsWith("[Pasted text #")
    ? attachment.displayName
    : getTextDisplayName(attachment.id, attachment.lineCount ?? 0);
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

export function cloneAttachment(attachment: AnyAttachment): AnyAttachment {
  if ("content" in attachment) {
    return {
      ...attachment,
      displayName: normalizeTextAttachmentDisplayName(attachment),
    };
  }
  return {
    ...attachment,
    displayName: attachment.type === "text"
      ? normalizeTextAttachmentDisplayName(attachment)
      : attachment.displayName,
    metadata: attachment.metadata ? { ...attachment.metadata } : undefined,
  };
}

export function cloneAttachments(
  attachments?: readonly AnyAttachment[],
): AnyAttachment[] {
  return attachments?.map((attachment) => cloneAttachment(attachment)) ?? [];
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

export function getPastedTextReferenceLineCount(content: string): number {
  return Math.max(0, countLines(content) - 1);
}

export function parseAttachmentReferences(
  text: string,
): AttachmentReferenceMatch[] {
  const refs: AttachmentReferenceMatch[] = [];

  for (const match of text.matchAll(TEXT_ATTACHMENT_REFERENCE_PATTERN)) {
    const id = Number(match[1]);
    if (!Number.isFinite(id) || id <= 0 || typeof match.index !== "number") {
      continue;
    }
    refs.push({
      id,
      kind: "text",
      match: match[0],
      index: match.index,
    });
  }

  for (const match of text.matchAll(BINARY_ATTACHMENT_REFERENCE_PATTERN)) {
    const id = Number(match[2]);
    if (!Number.isFinite(id) || id <= 0 || typeof match.index !== "number") {
      continue;
    }
    refs.push({
      id,
      kind: "attachment",
      match: match[0],
      index: match.index,
    });
  }

  return refs.sort((left, right) => left.index - right.index);
}

export function filterReferencedAttachments(
  text: string,
  attachments: readonly AnyAttachment[],
): AnyAttachment[] {
  if (attachments.length === 0) return [];
  const referencedIds = new Set(parseAttachmentReferences(text).map((ref) => ref.id));
  if (referencedIds.size === 0) return [];
  return attachments.filter((attachment) => referencedIds.has(attachment.id));
}

export function expandTextAttachmentReferences(
  text: string,
  attachments: readonly AnyAttachment[],
): string {
  const refs = parseAttachmentReferences(text);
  if (refs.length === 0) {
    return text;
  }

  const textById = new Map<number, string>();
  for (const attachment of attachments) {
    if ("content" in attachment) {
      textById.set(attachment.id, attachment.content);
    }
  }
  if (textById.size === 0) {
    return text;
  }

  let expanded = text;
  for (let i = refs.length - 1; i >= 0; i--) {
    const ref = refs[i]!;
    if (ref.kind !== "text") continue;
    const content = textById.get(ref.id);
    if (content === undefined) continue;
    expanded =
      expanded.slice(0, ref.index) +
      content +
      expanded.slice(ref.index + ref.match.length);
  }
  return expanded;
}

export function getPastedTextPreviewLabel(
  id: number,
  content: string,
  lineCount = getPastedTextReferenceLineCount(content),
): string {
  return getTextDisplayName(id, lineCount);
}

export async function createTextAttachment(
  content: string,
  id: number,
): Promise<TextAttachment | AttachmentError> {
  const lineCount = getPastedTextReferenceLineCount(content);
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
