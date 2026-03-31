import type {
  AttachmentKind,
  AttachmentMetadata,
  ConversationAttachmentKind,
} from "./types.ts";

const ATTACHMENT_EXT_TO_MIME: Record<string, string> = {
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
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".wma": "audio/x-ms-wma",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
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

export const TEXT_ATTACHMENT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "application/json",
  "application/xml",
  "text/html",
  "application/x-yaml",
]);

const MIME_TO_KIND: Record<string, AttachmentKind> = Object.fromEntries(
  Object.values(ATTACHMENT_EXT_TO_MIME).map((mime) => {
    const prefix = mime.split("/")[0];
    const kind: AttachmentKind = mime === "application/pdf"
      ? "pdf"
      : TEXT_ATTACHMENT_MIME_TYPES.has(mime)
      ? "text"
      : prefix === "image"
      ? "image"
      : prefix === "video"
      ? "video"
      : prefix === "audio"
      ? "audio"
      : "document";
    return [mime, kind];
  }),
);

const ATTACHMENT_SIZE_LIMITS: Record<AttachmentKind, number> = {
  image: 20 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  pdf: 50 * 1024 * 1024,
  text: 5 * 1024 * 1024,
  document: 50 * 1024 * 1024,
  file: 10 * 1024 * 1024,
};

const DISPLAY_LABELS: Record<AttachmentKind, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  pdf: "PDF",
  text: "Text",
  document: "Document",
  file: "File",
};

export function getFileExtension(path: string): string {
  const lastDot = path.lastIndexOf(".");
  return lastDot >= 0 ? path.slice(lastDot).toLowerCase() : "";
}

export function getAttachmentFileName(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}

function matchesAscii(bytes: Uint8Array, ascii: string, offset = 0): boolean {
  if (bytes.length < offset + ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[offset + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

function readUint16BE(
  bytes: Uint8Array,
  offset: number,
): number | undefined {
  if (bytes.length < offset + 2) return undefined;
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint16LE(
  bytes: Uint8Array,
  offset: number,
): number | undefined {
  if (bytes.length < offset + 2) return undefined;
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32BE(
  bytes: Uint8Array,
  offset: number,
): number | undefined {
  if (bytes.length < offset + 4) return undefined;
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0;
}

function readUint24LE(
  bytes: Uint8Array,
  offset: number,
): number | undefined {
  if (bytes.length < offset + 3) return undefined;
  return bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16);
}

function extractPngMetadata(
  bytes: Uint8Array,
): AttachmentMetadata | undefined {
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  if (!width || !height) return undefined;
  return { width, height };
}

function extractGifMetadata(
  bytes: Uint8Array,
): AttachmentMetadata | undefined {
  const width = readUint16LE(bytes, 6);
  const height = readUint16LE(bytes, 8);
  if (!width || !height) return undefined;
  return { width, height };
}

function isJpegStartOfFrameMarker(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function extractJpegMetadata(
  bytes: Uint8Array,
): AttachmentMetadata | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return undefined;
  }

  let offset = 2;
  while (offset + 1 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) {
      offset++;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset++;
    }
    if (offset >= bytes.length) return undefined;

    const marker = bytes[offset];
    offset++;

    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    const segmentLength = readUint16BE(bytes, offset);
    if (!segmentLength || segmentLength < 2) return undefined;

    if (isJpegStartOfFrameMarker(marker)) {
      const height = readUint16BE(bytes, offset + 3);
      const width = readUint16BE(bytes, offset + 5);
      if (!width || !height) return undefined;
      return { width, height };
    }

    offset += segmentLength;
  }

  return undefined;
}

function extractWebpMetadata(
  bytes: Uint8Array,
): AttachmentMetadata | undefined {
  if (
    bytes.length < 30 ||
    !matchesAscii(bytes, "RIFF") ||
    !matchesAscii(bytes, "WEBP", 8)
  ) {
    return undefined;
  }

  const chunkType = new TextDecoder().decode(bytes.subarray(12, 16));
  if (chunkType === "VP8X") {
    const width = readUint24LE(bytes, 24);
    const height = readUint24LE(bytes, 27);
    if (width === undefined || height === undefined) return undefined;
    return { width: width + 1, height: height + 1 };
  }

  if (chunkType === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const b1 = bytes[21];
    const b2 = bytes[22];
    const b3 = bytes[23];
    const b4 = bytes[24];
    return {
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
    };
  }

  return undefined;
}

function extractPdfMetadata(
  bytes: Uint8Array,
): AttachmentMetadata | undefined {
  const text = new TextDecoder("latin1").decode(bytes);
  const pages = [...text.matchAll(/\/Type\s*\/Page\b/g)].length;
  return pages > 0 ? { pages } : undefined;
}

function sniffAttachmentMimeType(
  bytes: Uint8Array,
): string | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    matchesAscii(bytes, "PNG", 1)
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (matchesAscii(bytes, "GIF87a") || matchesAscii(bytes, "GIF89a")) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    matchesAscii(bytes, "RIFF") &&
    matchesAscii(bytes, "WEBP", 8)
  ) {
    return "image/webp";
  }
  if (matchesAscii(bytes, "%PDF-")) {
    return "application/pdf";
  }
  if (
    bytes.length >= 12 &&
    matchesAscii(bytes, "ftyp", 4)
  ) {
    return "video/mp4";
  }
  if (
    bytes.length >= 12 &&
    matchesAscii(bytes, "RIFF") &&
    matchesAscii(bytes, "WAVE", 8)
  ) {
    return "audio/wav";
  }
  if (matchesAscii(bytes, "OggS")) {
    return "audio/ogg";
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return "audio/mpeg";
  }
  return undefined;
}

export function detectAttachmentMimeType(
  path: string,
  bytes?: Uint8Array,
  candidateMimeType?: string,
): string {
  const normalizedCandidate = candidateMimeType?.trim();
  if (normalizedCandidate) {
    return normalizedCandidate.split(";")[0].trim().toLowerCase();
  }
  const sniffed = bytes ? sniffAttachmentMimeType(bytes) : undefined;
  if (sniffed) return sniffed;
  return ATTACHMENT_EXT_TO_MIME[getFileExtension(path)] ??
    "application/octet-stream";
}

export function getAttachmentKind(mimeType: string): AttachmentKind {
  const normalizedMimeType = mimeType.toLowerCase();
  return MIME_TO_KIND[normalizedMimeType] ??
    (normalizedMimeType.startsWith("image/")
      ? "image"
      : normalizedMimeType.startsWith("audio/")
      ? "audio"
      : normalizedMimeType.startsWith("video/")
      ? "video"
      : "file");
}

export function getAttachmentSizeLimit(kind: AttachmentKind): number {
  return ATTACHMENT_SIZE_LIMITS[kind];
}

export function extractAttachmentMetadata(
  mimeType: string,
  bytes: Uint8Array,
): AttachmentMetadata | undefined {
  switch (mimeType.toLowerCase()) {
    case "image/png":
      return extractPngMetadata(bytes);
    case "image/gif":
      return extractGifMetadata(bytes);
    case "image/jpeg":
      return extractJpegMetadata(bytes);
    case "image/webp":
      return extractWebpMetadata(bytes);
    case "application/pdf":
      return extractPdfMetadata(bytes);
    default:
      return undefined;
  }
}

export function normalizeConversationAttachmentMimeType(
  mimeType: string,
): string {
  return TEXT_ATTACHMENT_MIME_TYPES.has(mimeType) ? "text/plain" : mimeType;
}

export function getConversationAttachmentKind(
  mimeType: string,
): ConversationAttachmentKind | null {
  const normalizedMimeType = normalizeConversationAttachmentMimeType(
    mimeType.toLowerCase(),
  );
  if (normalizedMimeType.startsWith("image/")) return "image";
  if (normalizedMimeType.startsWith("audio/")) return "audio";
  if (normalizedMimeType.startsWith("video/")) return "video";
  if (normalizedMimeType === "application/pdf") return "pdf";
  if (normalizedMimeType === "text/plain") return "text";
  return null;
}

export function isSupportedConversationAttachmentMimeType(
  mimeType: string,
): boolean {
  return getConversationAttachmentKind(mimeType) !== null;
}

export function getAttachmentDisplayName(
  kind: AttachmentKind,
  index: number,
): string {
  return `[${DISPLAY_LABELS[kind]} #${index}]`;
}

export function getTextAttachmentDisplayName(
  index: number,
  lineCount: number,
): string {
  return `[Pasted text #${index} +${lineCount} lines]`;
}
