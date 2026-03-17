import { Buffer } from "node:buffer";
import { promisify } from "node:util";
import {
  getAttachmentExtractedDir,
} from "../../common/paths.ts";
import { getPlatform } from "../../platform/platform.ts";
import type {
  AttachmentRecord,
  ConversationAttachmentMaterializationOptions,
} from "./types.ts";

const EXTRACTOR_VERSION = "broad-v1";
const TEXT_ATTACHMENT_PREVIEW_MAX_BYTES = 512 * 1024;
const DIRECT_TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "application/json",
  "application/xml",
  "text/html",
  "application/x-yaml",
]);
const OFFICEPARSER_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".xlsx",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
  ".rtf",
]);
const MAMMOTH_EXTENSIONS = new Set([".docx"]);
const SPREADSHEET_EXTENSIONS = new Set([".xls", ".xlsx"]);
const LIBREOFFICE_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
  ".rtf",
]);

interface ExtractedTextCacheEntry {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  kind: AttachmentRecord["kind"];
  size: number;
  extractorVersion: string;
  profile: string;
  text: string;
  extractedAt: string;
}

function fs() {
  return getPlatform().fs;
}

function path() {
  return getPlatform().path;
}

function safeFileName(fileName: string): string {
  const basename = path().basename(fileName.trim() || "attachment");
  return basename.replace(/[\\/]/g, "_") || "attachment";
}

function getFileExtension(fileName: string): string {
  return path().extname(fileName).toLowerCase();
}

function sanitizeExtractedText(text: string): string {
  return text.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
}

function containsExcessControlCharacters(text: string): boolean {
  let controlChars = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    const isControl = code < 0x20 && char !== "\n" && char !== "\r" &&
      char !== "\t";
    if (isControl) {
      controlChars++;
    }
  }
  return controlChars > Math.max(4, Math.floor(text.length * 0.01));
}

function tryDecodeUtf8Text(
  bytes: Uint8Array,
  options?: { allowHeuristic?: boolean },
): string | null {
  const maxLength = Math.min(bytes.length, TEXT_ATTACHMENT_PREVIEW_MAX_BYTES);
  const sample = bytes.subarray(0, maxLength);
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(sample);
    const sanitized = sanitizeExtractedText(decoded);
    if (!sanitized) return null;
    if (
      options?.allowHeuristic === false ||
      !containsExcessControlCharacters(sanitized)
    ) {
      return sanitized;
    }
  } catch {
    // Fall through to null.
  }
  return null;
}

function getDirectText(
  record: AttachmentRecord,
  bytes: Uint8Array,
): string | null {
  if (record.kind === "text" || DIRECT_TEXT_MIME_TYPES.has(record.mimeType)) {
    return tryDecodeUtf8Text(bytes, { allowHeuristic: false });
  }
  if (record.kind === "document" || record.kind === "file") {
    return tryDecodeUtf8Text(bytes, { allowHeuristic: true });
  }
  return null;
}

export function normalizeConversationMaterializationOptions(
  options?: ConversationAttachmentMaterializationOptions,
): Required<ConversationAttachmentMaterializationOptions> {
  const providerProfile = options?.providerProfile?.trim() || "default";
  const extractionProfile = options?.extractionProfile?.trim() ||
    providerProfile;
  return {
    providerProfile,
    extractionProfile,
    preferTextKinds: options?.preferTextKinds ?? [],
  };
}

function getExtractedTextCachePath(
  attachmentId: string,
  profile: string,
): string {
  const safeProfile = profile.replace(/[^a-z0-9_-]/gi, "_") || "default";
  return path().join(
    getAttachmentExtractedDir(),
    safeProfile,
    `${attachmentId}.${EXTRACTOR_VERSION}.json`,
  );
}

function extractedCacheMatchesRecord(
  entry: ExtractedTextCacheEntry,
  record: AttachmentRecord,
  profile: string,
): boolean {
  return entry.attachmentId === record.id &&
    entry.fileName === record.fileName &&
    entry.mimeType === record.mimeType &&
    entry.kind === record.kind &&
    entry.size === record.size &&
    entry.extractorVersion === EXTRACTOR_VERSION &&
    entry.profile === profile;
}

async function readExtractedTextCache(
  record: AttachmentRecord,
  profile: string,
): Promise<string | null> {
  const cachePath = getExtractedTextCachePath(record.id, profile);
  if (!await fs().exists(cachePath)) return null;
  try {
    const raw = await fs().readTextFile(cachePath);
    const parsed = JSON.parse(raw) as ExtractedTextCacheEntry;
    if (!extractedCacheMatchesRecord(parsed, record, profile)) {
      return null;
    }
    return sanitizeExtractedText(parsed.text);
  } catch {
    return null;
  }
}

async function writeExtractedTextCache(
  record: AttachmentRecord,
  profile: string,
  text: string,
): Promise<void> {
  const cachePath = getExtractedTextCachePath(record.id, profile);
  await fs().mkdir(path().dirname(cachePath), { recursive: true });
  const payload: ExtractedTextCacheEntry = {
    attachmentId: record.id,
    fileName: record.fileName,
    mimeType: record.mimeType,
    kind: record.kind,
    size: record.size,
    extractorVersion: EXTRACTOR_VERSION,
    profile,
    text,
    extractedAt: new Date().toISOString(),
  };
  await fs().writeTextFile(cachePath, JSON.stringify(payload, null, 2));
}

async function withTempAttachmentFile<T>(
  record: AttachmentRecord,
  bytes: Uint8Array,
  fn: (filePath: string) => Promise<T>,
): Promise<T> {
  const tempDir = await fs().makeTempDir({ prefix: "hlvm-attachment-" });
  const filePath = path().join(tempDir, safeFileName(record.fileName));
  try {
    await fs().writeFile(filePath, bytes);
    return await fn(filePath);
  } finally {
    try {
      await fs().remove(tempDir, { recursive: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}

async function extractWithOfficeParser(
  record: AttachmentRecord,
  bytes: Uint8Array,
): Promise<string | null> {
  const extension = getFileExtension(record.fileName);
  if (
    !OFFICEPARSER_EXTENSIONS.has(extension) &&
    record.mimeType !== "application/pdf"
  ) {
    return null;
  }
  try {
    const { default: officeParser } = await import("officeparser");
    return await withTempAttachmentFile(record, bytes, async (filePath) => {
      const ast = await officeParser.parseOffice(filePath);
      return sanitizeExtractedText(ast?.toText?.() ?? "");
    });
  } catch {
    return null;
  }
}

async function extractWithMammoth(
  record: AttachmentRecord,
  bytes: Uint8Array,
): Promise<string | null> {
  if (!MAMMOTH_EXTENSIONS.has(getFileExtension(record.fileName))) {
    return null;
  }
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.default.extractRawText({
      buffer: Buffer.from(bytes),
    });
    return sanitizeExtractedText(result.value ?? "");
  } catch {
    return null;
  }
}

function extractWithPdfTextFallback(
  record: AttachmentRecord,
  bytes: Uint8Array,
): string | null {
  if (
    record.mimeType !== "application/pdf" &&
    getFileExtension(record.fileName) !== ".pdf"
  ) {
    return null;
  }
  const decoded = new TextDecoder("latin1").decode(bytes);
  const literalStrings = [...decoded.matchAll(/\(([^()]*)\)/g)].map((match) =>
    match[1]
      ?.replace(/\\([()\\])/g, "$1")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t") ?? ""
  ).filter(Boolean);
  if (literalStrings.length > 0) {
    return sanitizeExtractedText(literalStrings.join("\n"));
  }
  return sanitizeExtractedText(decoded);
}

async function extractWithSpreadsheetFallback(
  record: AttachmentRecord,
  bytes: Uint8Array,
): Promise<string | null> {
  if (!SPREADSHEET_EXTENSIONS.has(getFileExtension(record.fileName))) {
    return null;
  }
  try {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(bytes, { type: "array" });
    const sheets = workbook.SheetNames.map((sheetName: string) => {
      const worksheet = workbook.Sheets[sheetName];
      return worksheet ? sanitizeExtractedText(XLSX.utils.sheet_to_txt(worksheet)) : "";
    }).filter(Boolean);
    return sheets.length > 0 ? sheets.join("\n\n") : null;
  } catch {
    return null;
  }
}

async function extractWithLibreOfficeFallback(
  record: AttachmentRecord,
  bytes: Uint8Array,
): Promise<string | null> {
  if (!LIBREOFFICE_EXTENSIONS.has(getFileExtension(record.fileName))) {
    return null;
  }
  try {
    const libre = await import("libreoffice-convert");
    const convertAsync = promisify(libre.default.convert.bind(libre.default));
    const textBuffer = await convertAsync(
      Buffer.from(bytes),
      ".txt",
      undefined,
    ) as Buffer;
    return sanitizeExtractedText(
      new TextDecoder("utf-8", { fatal: false }).decode(textBuffer),
    );
  } catch {
    return null;
  }
}

async function extractDocumentText(
  record: AttachmentRecord,
  bytes: Uint8Array,
): Promise<string | null> {
  const direct = getDirectText(record, bytes);
  if (direct) return direct;

  const extractors = [
    () => Promise.resolve(extractWithPdfTextFallback(record, bytes)),
    () => extractWithOfficeParser(record, bytes),
    () => extractWithMammoth(record, bytes),
    () => extractWithSpreadsheetFallback(record, bytes),
    () => extractWithLibreOfficeFallback(record, bytes),
  ];
  for (const extract of extractors) {
    const text = await extract();
    if (text) return text;
  }
  return null;
}

function shouldExtractTextForConversation(
  record: AttachmentRecord,
  materializationOptions?: ConversationAttachmentMaterializationOptions,
): boolean {
  const { preferTextKinds } = normalizeConversationMaterializationOptions(
    materializationOptions,
  );
  if (
    record.kind === "text" || record.kind === "document" ||
    record.kind === "file"
  ) {
    return true;
  }
  const conversationKind = record.kind === "pdf"
    ? "pdf"
    : record.kind === "image"
    ? "image"
    : record.kind === "audio"
    ? "audio"
    : record.kind === "video"
    ? "video"
    : record.kind === "text"
    ? "text"
    : null;
  return conversationKind !== null && conversationKind !== "text" &&
    preferTextKinds.includes(conversationKind);
}

export async function extractAttachmentText(
  record: AttachmentRecord,
  bytes: Uint8Array,
  materializationOptions?: ConversationAttachmentMaterializationOptions,
): Promise<string | null> {
  if (!shouldExtractTextForConversation(record, materializationOptions)) {
    return null;
  }

  const { extractionProfile } = normalizeConversationMaterializationOptions(
    materializationOptions,
  );
  const cached = await readExtractedTextCache(record, extractionProfile);
  if (cached) {
    return cached;
  }

  const extracted = await extractDocumentText(record, bytes);
  if (!extracted) {
    return null;
  }

  const sanitized = sanitizeExtractedText(extracted);
  if (!sanitized) {
    return null;
  }
  await writeExtractedTextCache(record, extractionProfile, sanitized);
  return sanitized;
}
