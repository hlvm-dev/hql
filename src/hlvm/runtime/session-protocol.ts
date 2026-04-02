import { getAttachmentRecords } from "../attachments/service.ts";
import { parseStoredStringArray } from "../store/message-utils.ts";
import type { MessageRow, PagedMessages } from "../store/types.ts";

export interface RuntimeMessageAttachment {
  id: string;
  file_name: string;
  mime_type: string;
  kind: string;
  size: number;
  source_path?: string;
  metadata?: {
    width?: number;
    height?: number;
    duration?: number;
    pages?: number;
  };
  content_url: string;
}

export interface RuntimeSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  session_version: number;
  metadata?: string | null;
}

export interface RuntimeSessionsResponse {
  sessions: RuntimeSession[];
}

export interface RuntimeSessionMessage
  extends Omit<MessageRow, "attachment_ids"> {
  attachment_ids?: string[];
  attachments?: RuntimeMessageAttachment[];
}

export interface RuntimeSessionMessagesResponse
  extends Omit<PagedMessages, "messages"> {
  messages: RuntimeSessionMessage[];
}

export interface RuntimeSessionMessageInput {
  role: MessageRow["role"];
  content: string;
  display_content?: string;
  client_turn_id?: string;
  sender_type?: string;
  attachment_ids?: string[];
}

async function resolveRuntimeMessageAttachments(
  attachmentIds: readonly string[] | undefined,
): Promise<RuntimeMessageAttachment[] | undefined> {
  if (!attachmentIds || attachmentIds.length === 0) return undefined;
  const records = await getAttachmentRecords(attachmentIds);
  if (records.length === 0) return undefined;

  const recordById = new Map(records.map((record) => [record.id, record]));
  const attachments = attachmentIds.flatMap((attachmentId) => {
    const record = recordById.get(attachmentId);
    if (!record) return [];
    return [{
      id: record.id,
      file_name: record.fileName,
      mime_type: record.mimeType,
      kind: record.kind,
      size: record.size,
      ...(record.sourcePath ? { source_path: record.sourcePath } : {}),
      ...(record.metadata ? { metadata: record.metadata } : {}),
      content_url: `/api/attachments/${record.id}/content`,
    }];
  });

  return attachments.length > 0 ? attachments : undefined;
}

export async function toRuntimeSessionMessage(
  message: MessageRow,
) : Promise<RuntimeSessionMessage> {
  const normalizedAttachmentIds = parseStoredStringArray(message.attachment_ids);
  const { attachment_ids: _rawAttachmentIds, ...rest } = message;
  return {
    ...rest,
    attachment_ids: normalizedAttachmentIds,
    attachments: await resolveRuntimeMessageAttachments(normalizedAttachmentIds),
  };
}

export async function toRuntimeSessionMessagesResponse(
  response: PagedMessages,
): Promise<RuntimeSessionMessagesResponse> {
  return {
    ...response,
    messages: await Promise.all(response.messages.map(toRuntimeSessionMessage)),
  };
}
