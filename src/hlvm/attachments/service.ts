import { encodeBase64 } from "@std/encoding/base64";
import {
  ensureAttachmentDirs,
  getAttachmentBlobsDir,
  getAttachmentPreparedDir,
  getAttachmentRecordsDir,
} from "../../common/paths.ts";
import { getErrorMessage, isFileNotFoundError } from "../../common/utils.ts";
import { getPlatform } from "../../platform/platform.ts";
import {
  detectAttachmentMimeType,
  extractAttachmentMetadata,
  getAttachmentFileName,
  getAttachmentKind,
  getAttachmentSizeLimit,
  getConversationAttachmentKind,
} from "./metadata.ts";
import {
  extractAttachmentText,
  normalizeConversationMaterializationOptions,
} from "./extractors.ts";
import {
  type AttachmentRecord,
  type AttachmentRegistrationInput,
  AttachmentServiceError,
  type ConversationAttachmentMaterializationOptions,
  type ConversationAttachmentPayload,
  type MaterializedAttachment,
  type PreparedAttachment,
} from "./types.ts";

const RECORD_VERSION = 1;

function path() {
  return getPlatform().path;
}

function fs() {
  return getPlatform().fs;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function createUnsupportedAttachmentError(
  record: AttachmentRecord,
): AttachmentServiceError {
  return new AttachmentServiceError(
    "unsupported_type",
    `Attachment cannot be sent to the model: ${record.fileName} (${record.mimeType}). The runtime cannot extract readable text from this file type.`,
    { path: record.sourcePath },
  );
}

async function validateAttachmentRegistration(
  record: AttachmentRecord,
  bytes: Uint8Array,
): Promise<void> {
  if (
    record.kind === "image" || record.kind === "audio" ||
    record.kind === "video"
  ) {
    return;
  }

  const extractedText = await extractAttachmentText(record, bytes, {
    providerProfile: "ingest",
  });

  if (record.kind === "pdf") {
    // PDF stays ingestible as a native binary input even when text fallback
    // cannot be extracted for all models.
    return;
  }

  if (extractedText !== null) {
    return;
  }

  throw createUnsupportedAttachmentError(record);
}

export async function materializeConversationAttachment(
  attachmentId: string,
  options?: string | ConversationAttachmentMaterializationOptions,
): Promise<ConversationAttachmentPayload> {
  const materializationOptions = typeof options === "string"
    ? normalizeConversationMaterializationOptions({ providerProfile: options })
    : normalizeConversationMaterializationOptions(options);
  const materialized = await materializeAttachment(
    attachmentId,
    materializationOptions.providerProfile,
  );
  const conversationKind = getConversationAttachmentKind(
    materialized.record.mimeType,
  );
  const shouldUseBinary = conversationKind &&
    conversationKind !== "text" &&
    !materializationOptions.preferTextKinds.includes(conversationKind);

  if (shouldUseBinary) {
    return {
      mode: "binary",
      attachmentId: materialized.record.id,
      fileName: materialized.record.fileName,
      mimeType: materialized.record.mimeType,
      kind: materialized.record.kind,
      conversationKind,
      size: materialized.record.size,
      data: materialized.prepared.data,
    };
  }

  const { bytes } = await readAttachmentContent(materialized.record.id);
  const extractedText = await extractAttachmentText(
    materialized.record,
    bytes,
    materializationOptions,
  );
  if (extractedText !== null) {
    return {
      mode: "text",
      attachmentId: materialized.record.id,
      fileName: materialized.record.fileName,
      mimeType: materialized.record.mimeType,
      kind: materialized.record.kind,
      conversationKind: "text",
      size: materialized.record.size,
      text: extractedText,
    };
  }

  throw createUnsupportedAttachmentError(materialized.record);
}

function getAttachmentId(blobSha256: string): string {
  return `att_${blobSha256}`;
}

function getRecordPath(attachmentId: string): string {
  return path().join(getAttachmentRecordsDir(), `${attachmentId}.json`);
}

function getBlobPath(blobSha256: string): string {
  return path().join(
    getAttachmentBlobsDir(),
    blobSha256.slice(0, 2),
    blobSha256.slice(2, 4),
    blobSha256,
  );
}

function getPreparedPath(
  attachmentId: string,
  providerProfile: string,
): string {
  const safeProfile = providerProfile.replace(/[^a-z0-9_-]/gi, "_") ||
    "default";
  return path().join(
    getAttachmentPreparedDir(),
    safeProfile,
    `${attachmentId}.json`,
  );
}

async function ensureParentDir(filePath: string): Promise<void> {
  await fs().mkdir(path().dirname(filePath), { recursive: true });
}

async function writeJson(
  filePath: string,
  value: unknown,
): Promise<void> {
  await ensureParentDir(filePath);
  await fs().writeTextFile(filePath, JSON.stringify(value, null, 2));
}

async function writeBlobIfMissing(
  blobSha256: string,
  bytes: Uint8Array,
): Promise<string> {
  const blobPath = getBlobPath(blobSha256);
  if (await fs().exists(blobPath)) return blobPath;
  await ensureParentDir(blobPath);
  await fs().writeFile(blobPath, bytes);
  return blobPath;
}

async function readRecord(
  recordPath: string,
): Promise<AttachmentRecord | null> {
  if (!await fs().exists(recordPath)) return null;
  const raw = await fs().readTextFile(recordPath);
  const parsed = JSON.parse(raw) as AttachmentRecord & { version?: number };
  return {
    ...parsed,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
  };
}

async function writeRecord(record: AttachmentRecord): Promise<void> {
  await writeJson(getRecordPath(record.id), {
    version: RECORD_VERSION,
    ...record,
  });
}

function preparedAttachmentMatchesRecord(
  prepared: PreparedAttachment,
  record: AttachmentRecord,
): boolean {
  return prepared.attachmentId === record.id &&
    prepared.fileName === record.fileName &&
    prepared.mimeType === record.mimeType &&
    prepared.kind === record.kind &&
    prepared.size === record.size;
}

async function touchAttachmentRecord(
  record: AttachmentRecord,
): Promise<AttachmentRecord> {
  const now = new Date().toISOString();
  const touched: AttachmentRecord = {
    ...record,
    lastAccessedAt: now,
  };
  await writeRecord(touched);
  return touched;
}

async function registerAttachmentBytes(
  input: AttachmentRegistrationInput,
): Promise<AttachmentRecord> {
  await ensureAttachmentDirs();

  if (input.bytes.length === 0) {
    throw new AttachmentServiceError(
      "invalid_upload",
      "Attachment is empty.",
    );
  }

  const fileName = input.fileName.trim() || "attachment.bin";
  const mimeType = detectAttachmentMimeType(
    fileName,
    input.bytes,
    input.mimeType,
  );
  const kind = getAttachmentKind(mimeType);
  const sizeLimit = getAttachmentSizeLimit(kind);
  if (input.bytes.length > sizeLimit) {
    throw new AttachmentServiceError(
      "size_exceeded",
      `Attachment too large: ${input.bytes.length} bytes exceeds ${sizeLimit} byte limit.`,
      { path: input.sourcePath },
    );
  }

  const blobSha256 = await sha256Hex(input.bytes);
  const attachmentId = getAttachmentId(blobSha256);
  const recordPath = getRecordPath(attachmentId);
  const metadata = extractAttachmentMetadata(mimeType, input.bytes);
  const now = new Date().toISOString();
  const candidateRecord: AttachmentRecord = {
    id: attachmentId,
    blobSha256,
    fileName,
    mimeType,
    kind,
    size: input.bytes.length,
    ...(metadata ? { metadata } : {}),
    ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  };
  await validateAttachmentRegistration(candidateRecord, input.bytes);
  const existing = await readRecord(recordPath);
  if (existing) {
    await writeBlobIfMissing(blobSha256, input.bytes);

    const promotedMimeType = existing.mimeType === "application/octet-stream" &&
        mimeType !== existing.mimeType
      ? mimeType
      : existing.mimeType;
    const promotedKind = existing.kind === "file" && kind !== existing.kind
      ? kind
      : existing.kind;
    const updated: AttachmentRecord = {
      ...existing,
      fileName,
      mimeType: promotedMimeType,
      kind: promotedKind,
      ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
      ...(metadata
        ? { metadata }
        : existing.metadata
        ? { metadata: existing.metadata }
        : {}),
      updatedAt: now,
      lastAccessedAt: now,
    };
    await writeRecord(updated);
    return updated;
  }

  await writeBlobIfMissing(blobSha256, input.bytes);
  const record: AttachmentRecord = candidateRecord;
  await writeRecord(record);
  return record;
}

export async function registerAttachmentFromPath(
  filePath: string,
): Promise<AttachmentRecord> {
  const platform = getPlatform();
  const resolvedPath = platform.path.resolve(filePath);
  let info: { isFile: boolean; isDirectory: boolean; size: number };
  try {
    info = await platform.fs.stat(resolvedPath);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      throw new AttachmentServiceError(
        "not_found",
        `File not found: ${resolvedPath}`,
        { path: resolvedPath },
      );
    }
    if (error instanceof Error && error.name === "PermissionDenied") {
      throw new AttachmentServiceError(
        "permission_denied",
        `Permission denied: ${resolvedPath}`,
        { path: resolvedPath },
      );
    }
    throw new AttachmentServiceError(
      "read_error",
      `Failed to stat attachment: ${getErrorMessage(error)}`,
      { path: resolvedPath },
    );
  }

  if (info.isDirectory) {
    throw new AttachmentServiceError(
      "unsupported_type",
      `Cannot attach directory: ${resolvedPath}`,
      { path: resolvedPath },
    );
  }

  try {
    const bytes = await platform.fs.readFile(resolvedPath);
    return await registerAttachmentBytes({
      fileName: getAttachmentFileName(resolvedPath),
      bytes,
      sourcePath: resolvedPath,
    });
  } catch (error) {
    if (error instanceof AttachmentServiceError) throw error;
    throw new AttachmentServiceError(
      "read_error",
      `Failed to read attachment: ${getErrorMessage(error)}`,
      { path: resolvedPath },
    );
  }
}

export async function registerUploadedAttachment(
  input: AttachmentRegistrationInput,
): Promise<AttachmentRecord> {
  return await registerAttachmentBytes(input);
}

export async function registerTextAttachment(
  content: string,
  fileName = "pasted-text.txt",
): Promise<AttachmentRecord> {
  const bytes = new TextEncoder().encode(content);
  return await registerAttachmentBytes({
    fileName,
    bytes,
    mimeType: "text/plain",
  });
}

export async function getAttachmentRecord(
  attachmentId: string,
): Promise<AttachmentRecord | null> {
  await ensureAttachmentDirs();
  return await readRecord(getRecordPath(attachmentId));
}

export async function getAttachmentRecords(
  attachmentIds: readonly string[],
): Promise<AttachmentRecord[]> {
  const resolved = await Promise.all(
    attachmentIds.map((attachmentId) => getAttachmentRecord(attachmentId)),
  );
  return resolved.filter((record): record is AttachmentRecord =>
    record !== null
  );
}

export async function readAttachmentContent(
  attachmentId: string,
): Promise<{ record: AttachmentRecord; bytes: Uint8Array }> {
  const [record] = await getRequiredAttachmentRecords([attachmentId]);
  const blobPath = getBlobPath(record.blobSha256);
  if (!await fs().exists(blobPath)) {
    throw new AttachmentServiceError(
      "not_found",
      `Attachment blob missing for ${attachmentId}.`,
    );
  }

  try {
    const bytes = await fs().readFile(blobPath);
    const touched = await touchAttachmentRecord(record);
    return { record: touched, bytes };
  } catch (error) {
    throw new AttachmentServiceError(
      "read_error",
      `Failed to read attachment content: ${getErrorMessage(error)}`,
      { path: blobPath },
    );
  }
}

async function getRequiredAttachmentRecords(
  attachmentIds: readonly string[],
): Promise<AttachmentRecord[]> {
  const resolved = await Promise.all(
    attachmentIds.map((attachmentId) => getAttachmentRecord(attachmentId)),
  );
  const missing = attachmentIds.filter((_attachmentId, index) =>
    resolved[index] === null
  );
  if (missing.length > 0) {
    throw new AttachmentServiceError(
      "not_found",
      missing.length === 1
        ? `Attachment not found: ${missing[0]}`
        : `Attachments not found: ${missing.join(", ")}`,
    );
  }
  return resolved.filter((record): record is AttachmentRecord =>
    record !== null
  );
}

async function prepareAttachmentForProfile(
  record: AttachmentRecord,
  providerProfile: string,
): Promise<PreparedAttachment> {
  await ensureAttachmentDirs();

  const preparedPath = getPreparedPath(record.id, providerProfile);
  if (await fs().exists(preparedPath)) {
    const cached = JSON.parse(
      await fs().readTextFile(preparedPath),
    ) as PreparedAttachment;
    if (preparedAttachmentMatchesRecord(cached, record)) {
      return cached;
    }
  }

  const blobPath = getBlobPath(record.blobSha256);
  if (!await fs().exists(blobPath)) {
    throw new AttachmentServiceError(
      "not_found",
      `Attachment blob missing for ${record.id}.`,
    );
  }

  const bytes = await fs().readFile(blobPath);
  const prepared: PreparedAttachment = {
    attachmentId: record.id,
    fileName: record.fileName,
    mimeType: record.mimeType,
    kind: record.kind,
    size: record.size,
    data: encodeBase64(bytes),
  };
  await ensureParentDir(preparedPath);
  await fs().writeTextFile(preparedPath, JSON.stringify(prepared, null, 2));
  return prepared;
}

export async function materializeAttachment(
  attachmentId: string,
  providerProfile = "default",
): Promise<MaterializedAttachment> {
  const [record] = await getRequiredAttachmentRecords([attachmentId]);
  const touchedRecord = await touchAttachmentRecord(record);
  const prepared = await prepareAttachmentForProfile(
    touchedRecord,
    providerProfile,
  );
  return { record: touchedRecord, prepared };
}

export async function materializeConversationAttachments(
  attachmentIds: readonly string[],
  options?: string | ConversationAttachmentMaterializationOptions,
): Promise<ConversationAttachmentPayload[]> {
  if (attachmentIds.length === 0) return [];
  return await Promise.all(
    attachmentIds.map((attachmentId) =>
      materializeConversationAttachment(attachmentId, options)
    ),
  );
}
