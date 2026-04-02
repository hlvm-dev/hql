import { assertEquals } from "jsr:@std/assert";
import { registerUploadedAttachment } from "../../../src/hlvm/attachments/service.ts";
import {
  toRuntimeSessionMessage,
  toRuntimeSessionMessagesResponse,
} from "../../../src/hlvm/runtime/session-protocol.ts";
import type {
  MessageRow,
  PagedMessages,
} from "../../../src/hlvm/store/types.ts";

Deno.test("toRuntimeSessionMessage normalizes stored attachment ids to the runtime response shape", async () => {
  const message = {
    id: 1,
    session_id: "sess-1",
    order: 1,
    role: "user",
    content: "hello",
    display_content: "[Pasted text #1]",
    client_turn_id: "turn-1",
    request_id: null,
    sender_type: "user",
    sender_detail: null,
    attachment_ids: JSON.stringify(["att_1", "att_2"]),
    tool_calls: null,
    tool_name: null,
    tool_call_id: null,
    cancelled: 0,
    created_at: "2026-03-17T00:00:00.000Z",
  } satisfies MessageRow;

  const adapted = await toRuntimeSessionMessage(message);

  assertEquals(adapted.attachment_ids, ["att_1", "att_2"]);
  assertEquals(adapted.display_content, "[Pasted text #1]");
  assertEquals(adapted.attachments, undefined);
});

Deno.test("toRuntimeSessionMessage resolves runtime attachment metadata", async () => {
  const record = await registerUploadedAttachment({
    fileName: "example.png",
    mimeType: "image/png",
    bytes: Uint8Array.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0x00,
      0x00,
      0x00,
      0x0d,
      0x49,
      0x48,
      0x44,
      0x52,
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
      0x01,
      0x08,
      0x06,
      0x00,
      0x00,
      0x00,
      0x1f,
      0x15,
      0xc4,
      0x89,
    ]),
  });

  const message = {
    id: 1,
    session_id: "sess-1",
    order: 1,
    role: "user",
    content: "hello",
    display_content: null,
    client_turn_id: "turn-1",
    request_id: null,
    sender_type: "user",
    sender_detail: null,
    attachment_ids: JSON.stringify([record.id]),
    tool_calls: null,
    tool_name: null,
    tool_call_id: null,
    cancelled: 0,
    created_at: "2026-03-17T00:00:00.000Z",
  } satisfies MessageRow;

  const adapted = await toRuntimeSessionMessage(message);

  assertEquals(adapted.attachments, [{
    id: record.id,
    file_name: "example.png",
    mime_type: "image/png",
    kind: "image",
    size: record.size,
    metadata: { width: 1, height: 1 },
    content_url: `/api/attachments/${record.id}/content`,
  }]);
});

Deno.test("toRuntimeSessionMessagesResponse adapts every message through the same SSOT mapper", async () => {
  const response = {
    messages: [{
      id: 1,
      session_id: "sess-1",
      order: 1,
      role: "assistant",
      content: "hello",
      display_content: null,
      client_turn_id: null,
      request_id: "req-1",
      sender_type: "assistant",
      sender_detail: null,
      attachment_ids: JSON.stringify(["att_1"]),
      tool_calls: null,
      tool_name: null,
      tool_call_id: null,
      cancelled: 0,
      created_at: "2026-03-17T00:00:00.000Z",
    }],
    total: 1,
    has_more: false,
    session_version: 1,
  } satisfies PagedMessages;

  const adapted = await toRuntimeSessionMessagesResponse(response);

  assertEquals(adapted.messages.length, 1);
  assertEquals(adapted.messages[0]?.attachment_ids, ["att_1"]);
  assertEquals(adapted.messages[0]?.attachments, undefined);
});
