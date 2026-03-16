import { getErrorMessage } from "../../../../common/utils.ts";
import {
  getAttachmentRecord,
  registerAttachmentFromPath,
  registerUploadedAttachment,
} from "../../../attachments/service.ts";
import { AttachmentServiceError } from "../../../attachments/types.ts";
import type { RouteParams } from "../http-router.ts";
import { jsonError, parseJsonBody } from "../http-utils.ts";

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

export async function handleRegisterAttachment(
  req: Request,
): Promise<Response> {
  const parsed = await parseJsonBody<{ path?: string }>(req);
  if (!parsed.ok) return parsed.response;

  const filePath = parsed.value.path?.trim();
  if (!filePath) {
    return jsonError("path is required", 400);
  }

  try {
    const record = await registerAttachmentFromPath(filePath);
    return Response.json(record, { status: 201 });
  } catch (error) {
    if (error instanceof AttachmentServiceError) {
      return toAttachmentErrorResponse(error);
    }
    return jsonError(getErrorMessage(error), 500);
  }
}

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
    const bytes = new Uint8Array(await file.arrayBuffer());
    const record = await registerUploadedAttachment({
      fileName: file.name || "attachment.bin",
      bytes,
      mimeType: file.type || undefined,
      sourcePath: typeof sourcePath === "string" ? sourcePath : undefined,
    });
    return Response.json(record, { status: 201 });
  } catch (error) {
    if (error instanceof AttachmentServiceError) {
      return toAttachmentErrorResponse(error);
    }
    return jsonError(getErrorMessage(error), 500);
  }
}

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
