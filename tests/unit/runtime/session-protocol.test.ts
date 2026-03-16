import { assertEquals } from "jsr:@std/assert";
import {
  toRuntimeSessionMessage,
  toRuntimeSessionMessagesResponse,
} from "../../../src/hlvm/runtime/session-protocol.ts";
import type {
  MessageRow,
  PagedMessages,
} from "../../../src/hlvm/store/types.ts";

Deno.test("toRuntimeSessionMessage normalizes attachment ids and strips raw image_paths", () => {
  const message = {
    id: 1,
    session_id: "sess-1",
    order: 1,
    role: "user",
    content: "hello",
    client_turn_id: "turn-1",
    request_id: null,
    sender_type: "user",
    sender_detail: null,
    attachment_ids: JSON.stringify(["att_1", "att_2"]),
    image_paths: JSON.stringify(["/tmp/example.png"]),
    tool_calls: null,
    tool_name: null,
    tool_call_id: null,
    cancelled: 0,
    created_at: "2026-03-17T00:00:00.000Z",
  } satisfies MessageRow & { image_paths?: string | null };

  const adapted = toRuntimeSessionMessage(message);

  assertEquals(adapted.attachment_ids, ["att_1", "att_2"]);
  assertEquals(adapted.legacy_image_paths, ["/tmp/example.png"]);
  assertEquals(
    "image_paths" in (adapted as unknown as Record<string, unknown>),
    false,
  );
});

Deno.test("toRuntimeSessionMessagesResponse adapts every message through the same SSOT mapper", () => {
  const response = {
    messages: [{
      id: 1,
      session_id: "sess-1",
      order: 1,
      role: "assistant",
      content: "hello",
      client_turn_id: null,
      request_id: "req-1",
      sender_type: "assistant",
      sender_detail: null,
      attachment_ids: JSON.stringify(["att_1"]),
      image_paths: null,
      tool_calls: null,
      tool_name: null,
      tool_call_id: null,
      cancelled: 0,
      created_at: "2026-03-17T00:00:00.000Z",
    }],
    total: 1,
    has_more: false,
    session_version: 1,
  } satisfies PagedMessages & {
    messages: Array<MessageRow & { image_paths?: string | null }>;
  };

  const adapted = toRuntimeSessionMessagesResponse(response);

  assertEquals(adapted.messages.length, 1);
  assertEquals(adapted.messages[0]?.attachment_ids, ["att_1"]);
  assertEquals(adapted.messages[0]?.legacy_image_paths, undefined);
  assertEquals(
    "image_paths" in
      (adapted.messages[0]! as unknown as Record<string, unknown>),
    false,
  );
});
