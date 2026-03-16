import {
  parseLegacyImagePaths,
  parseStoredStringArray,
} from "../store/message-utils.ts";
import type { MessageRow, PagedMessages } from "../store/types.ts";

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
  legacy_image_paths?: string[];
}

export interface RuntimeSessionMessagesResponse
  extends Omit<PagedMessages, "messages"> {
  messages: RuntimeSessionMessage[];
}

export interface RuntimeSessionMessageInput {
  role: MessageRow["role"];
  content: string;
  client_turn_id?: string;
  sender_type?: string;
  attachment_ids?: string[];
}

export function toRuntimeSessionMessage(
  message: MessageRow,
): RuntimeSessionMessage {
  const {
    attachment_ids,
    image_paths: _legacyImagePaths,
    ...rest
  } = message as MessageRow & { image_paths?: string | null };
  return {
    ...rest,
    attachment_ids: parseStoredStringArray(attachment_ids),
    legacy_image_paths: parseLegacyImagePaths(
      message as MessageRow & { image_paths?: string | null },
    ),
  };
}

export function toRuntimeSessionMessagesResponse(
  response: PagedMessages,
): RuntimeSessionMessagesResponse {
  return {
    ...response,
    messages: response.messages.map(toRuntimeSessionMessage),
  };
}
