import { getErrorMessage } from "../../../../common/utils.ts";
import {
  getAttachmentRecord,
  readAttachmentContent,
  registerAttachmentFromPath,
  registerUploadedAttachment,
} from "../../../attachments/service.ts";
import { AttachmentServiceError } from "../../../attachments/types.ts";
import type { RouteParams } from "../http-router.ts";
import { jsonError, parseJsonBody } from "../http-utils.ts";

function parseOptionalInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalFloat(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseAttachmentMetadata(input: {
  width?: unknown;
  height?: unknown;
  duration?: unknown;
  pages?: unknown;
}) {
  const width = parseOptionalInteger(input.width);
  const height = parseOptionalInteger(input.height);
  const duration = parseOptionalFloat(input.duration);
  const pages = parseOptionalInteger(input.pages);

  if (
    width === undefined &&
    height === undefined &&
    duration === undefined &&
    pages === undefined
  ) {
    return undefined;
  }

  return {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(pages !== undefined ? { pages } : {}),
  };
}

function toAttachmentErrorResponse(error: AttachmentServiceError): Response {
  switch (error.code) {
    case "not_found":
      return jsonError(error.message, 404);
    case "permission_denied":
      return jsonError(error.message, 403);
    case "size_exceeded":
      return jsonError(error.message, 413);
    case "unsupported_type":
    case "invalid_upload":
      return jsonError(error.message, 400);
    case "read_error":
    default:
      return jsonError(error.message, 500);
  }
}

/**
 * @openapi
 * /api/attachments/register:
 *   post:
 *     tags: [Attachments]
 *     summary: Register an existing file as an attachment
 *     operationId: registerAttachment
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               path:
 *                 type: string
 *             required: [path]
 *     responses:
 *       '201':
 *         description: Attachment registered.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AttachmentRecord'
 *       '400':
 *         description: Invalid path or unsupported file.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Permission denied.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: File not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export async function handleRegisterAttachment(
  req: Request,
): Promise<Response> {
  const parsed = await parseJsonBody<{
    path?: string;
    metadata?: {
      width?: number;
      height?: number;
      duration?: number;
      pages?: number;
    };
  }>(req);
  if (!parsed.ok) return parsed.response;

  const filePath = parsed.value.path?.trim();
  if (!filePath) {
    return jsonError("path is required", 400);
  }

  try {
    const record = await registerAttachmentFromPath(
      filePath,
      parseAttachmentMetadata(parsed.value.metadata ?? {}),
    );
    return Response.json(record, { status: 201 });
  } catch (error) {
    if (error instanceof AttachmentServiceError) {
      return toAttachmentErrorResponse(error);
    }
    return jsonError(getErrorMessage(error), 500);
  }
}

/**
 * @openapi
 * /api/attachments/upload:
 *   post:
 *     tags: [Attachments]
 *     summary: Upload attachment bytes
 *     operationId: uploadAttachment
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               source_path:
 *                 type: string
 *             required: [file]
 *     responses:
 *       '201':
 *         description: Attachment uploaded.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AttachmentRecord'
 *       '400':
 *         description: Invalid upload.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '413':
 *         description: Attachment too large.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export async function handleUploadAttachment(
  req: Request,
): Promise<Response> {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return jsonError("file is required", 400);
    }

    const sourcePath = form.get("source_path");
    const metadata = parseAttachmentMetadata({
      width: form.get("metadata_width"),
      height: form.get("metadata_height"),
      duration: form.get("metadata_duration"),
      pages: form.get("metadata_pages"),
    });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const record = await registerUploadedAttachment({
      fileName: file.name || "attachment.bin",
      bytes,
      mimeType: file.type || undefined,
      sourcePath: typeof sourcePath === "string" ? sourcePath : undefined,
      metadata,
    });
    return Response.json(record, { status: 201 });
  } catch (error) {
    if (error instanceof AttachmentServiceError) {
      return toAttachmentErrorResponse(error);
    }
    return jsonError(getErrorMessage(error), 500);
  }
}

/**
 * @openapi
 * /api/attachments/{id}:
 *   get:
 *     tags: [Attachments]
 *     summary: Get attachment metadata
 *     operationId: getAttachment
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Attachment metadata.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AttachmentRecord'
 *       '404':
 *         description: Attachment not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export async function handleGetAttachment(
  _req: Request,
  params: RouteParams,
): Promise<Response> {
  const record = await getAttachmentRecord(params.id);
  if (!record) {
    return jsonError("Attachment not found", 404);
  }
  return Response.json(record);
}

/**
 * @openapi
 * /api/attachments/{id}/content:
 *   get:
 *     tags: [Attachments]
 *     summary: Get raw attachment content
 *     operationId: getAttachmentContent
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Raw attachment bytes.
 *         content:
 *           image/*:
 *             schema:
 *               type: string
 *               format: binary
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       '404':
 *         description: Attachment not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export async function handleGetAttachmentContent(
  _req: Request,
  params: RouteParams,
): Promise<Response> {
  try {
    const { record, bytes } = await readAttachmentContent(params.id);
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": record.mimeType || "application/octet-stream",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    if (error instanceof AttachmentServiceError) {
      return toAttachmentErrorResponse(error);
    }
    return jsonError(getErrorMessage(error), 500);
  }
}
