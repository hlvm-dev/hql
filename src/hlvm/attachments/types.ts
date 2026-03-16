export type AttachmentKind =
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "text"
  | "document"
  | "file";

export type ConversationAttachmentKind =
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "text";

export interface AttachmentMetadata {
  width?: number;
  height?: number;
  duration?: number;
  pages?: number;
}

export interface AttachmentRecord {
  id: string;
  blobSha256: string;
  fileName: string;
  mimeType: string;
  kind: AttachmentKind;
  size: number;
  sourcePath?: string;
  metadata?: AttachmentMetadata;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string;
}

export interface PreparedAttachment {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  kind: AttachmentKind;
  size: number;
  data: string;
}

export interface MaterializedAttachment {
  record: AttachmentRecord;
  prepared: PreparedAttachment;
}

export interface AttachmentRegistrationInput {
  fileName: string;
  bytes: Uint8Array;
  sourcePath?: string;
  mimeType?: string;
}

export type AttachmentServiceErrorCode =
  | "not_found"
  | "permission_denied"
  | "size_exceeded"
  | "unsupported_type"
  | "read_error"
  | "invalid_upload";

export class AttachmentServiceError extends Error {
  readonly code: AttachmentServiceErrorCode;
  readonly path?: string;

  constructor(
    code: AttachmentServiceErrorCode,
    message: string,
    options?: { path?: string },
  ) {
    super(message);
    this.name = "AttachmentServiceError";
    this.code = code;
    this.path = options?.path;
  }
}
