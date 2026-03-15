import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { clearCurrentSession, session } from "../../../src/hlvm/api/session.ts";
import type { MessageRow } from "../../../src/hlvm/store/types.ts";
import { withRuntimeHostServer } from "../../shared/light-helpers.ts";

Deno.test("session API lists, loads, resumes, exports, and counts runtime conversation sessions", async () => {
  const runtimeSession = {
    id: "sess-1",
    title: "",
    created_at: "2026-03-07T00:00:00.000Z",
    updated_at: "2026-03-07T00:05:00.000Z",
    message_count: 3,
    session_version: 2,
    metadata: null,
  };
  const messages: MessageRow[] = [
    {
      id: 1,
      session_id: "sess-1",
      order: 1,
      role: "user",
      content: "hello",
      client_turn_id: "turn-1",
      request_id: null,
      sender_type: "user",
      sender_detail: null,
      image_paths: null,
      tool_calls: null,
      tool_name: null,
      tool_call_id: null,
      cancelled: 0,
      created_at: "2026-03-07T00:00:00.000Z",
    },
    {
      id: 2,
      session_id: "sess-1",
      order: 2,
      role: "assistant",
      content: "hi",
      client_turn_id: "turn-1",
      request_id: null,
      sender_type: "assistant",
      sender_detail: null,
      image_paths: null,
      tool_calls: null,
      tool_name: null,
      tool_call_id: null,
      cancelled: 0,
      created_at: "2026-03-07T00:00:02.000Z",
    },
    {
      id: 3,
      session_id: "sess-1",
      order: 3,
      role: "tool",
      content: "file contents",
      client_turn_id: "turn-1",
      request_id: null,
      sender_type: "agent",
      sender_detail: null,
      image_paths: null,
      tool_calls: JSON.stringify([{
        argsSummary: "README.md",
        success: true,
      }]),
      tool_name: "read_file",
      tool_call_id: null,
      cancelled: 0,
      created_at: "2026-03-07T00:00:03.000Z",
    },
  ];

  clearCurrentSession();

  await withRuntimeHostServer(async (req) => {
    const url = new URL(req.url);

    if (url.pathname === "/api/sessions") {
      return Response.json({ sessions: [runtimeSession] });
    }

    if (url.pathname === "/api/sessions/sess-1/messages") {
      return Response.json({
        messages,
        total: messages.length,
        has_more: false,
        session_version: 2,
      });
    }

    if (url.pathname === "/api/sessions/sess-1") {
      return Response.json(runtimeSession);
    }

    return new Response("Not found", { status: 404 });
  }, async () => {
    const listed = await session.list({ limit: 10, sortOrder: "recent" });
    const loaded = await session.get("sess-1");
    const resumed = await session.resume("sess-1");
    const exported = await session.export("sess-1");

    assertEquals(listed.length, 1);
    assertEquals(listed[0]?.id, "sess-1");
    assertEquals(listed[0]?.title, "Session sess-1");
    assertEquals(loaded?.messages, [
      {
        role: "user",
        content: "hello",
        ts: Date.parse("2026-03-07T00:00:00.000Z"),
      },
      {
        role: "assistant",
        content: "hi",
        ts: Date.parse("2026-03-07T00:00:02.000Z"),
      },
      {
        role: "tool",
        content: "file contents",
        ts: Date.parse("2026-03-07T00:00:03.000Z"),
        toolName: "read_file",
        toolArgsSummary: "README.md",
        toolSuccess: true,
      },
    ]);
    assertEquals(resumed?.meta.id, "sess-1");
    assertEquals(session.current()?.id, "sess-1");
    assertEquals(await session.count(), 1);
    assertEquals(await session.has("sess-1"), true);
    assertStringIncludes(exported ?? "", "# Session sess-1");
    assertStringIncludes(exported ?? "", "[tool:read_file] file contents");
  });

  clearCurrentSession();
});

Deno.test("session API records into runtime conversation sessions and clears current state on delete", async () => {
  let createdMessageCount = 0;
  const recordedMessages: Array<Record<string, unknown>> = [];

  clearCurrentSession();

  await withRuntimeHostServer(async (req) => {
    const url = new URL(req.url);

    if (url.pathname === "/api/sessions" && req.method === "POST") {
      await req.json();
      return Response.json({
        id: "created-1",
        title: "",
        created_at: "2026-03-07T00:10:00.000Z",
        updated_at: "2026-03-07T00:10:00.000Z",
        message_count: createdMessageCount,
        session_version: 1,
        metadata: null,
      }, { status: 201 });
    }

    if (
      url.pathname === "/api/sessions/created-1/messages" &&
      req.method === "POST"
    ) {
      const body = await req.json() as Record<string, unknown>;
      recordedMessages.push(body);
      createdMessageCount += 1;
      return Response.json({
        id: createdMessageCount,
        session_id: "created-1",
        order: createdMessageCount,
        role: body.role,
        content: body.content,
        client_turn_id: null,
        request_id: null,
        sender_type: body.sender_type,
        sender_detail: null,
        image_paths: body.image_paths ? JSON.stringify(body.image_paths) : null,
        tool_calls: null,
        tool_name: null,
        tool_call_id: null,
        cancelled: 0,
        created_at: `2026-03-07T00:10:0${createdMessageCount}.000Z`,
      }, { status: 201 });
    }

    if (url.pathname === "/api/sessions/created-1") {
      if (req.method === "DELETE") {
        return Response.json({ deleted: true });
      }
      return Response.json({
        id: "created-1",
        title: "",
        created_at: "2026-03-07T00:10:00.000Z",
        updated_at: "2026-03-07T00:10:05.000Z",
        message_count: createdMessageCount,
        session_version: createdMessageCount + 1,
        metadata: null,
      });
    }

    return new Response("Not found", { status: 404 });
  }, async () => {
    await session.record("user", "hello", ["image.png"]);
    await session.record("assistant", "hi");

    assertEquals(recordedMessages.length, 2);
    assertEquals(recordedMessages[0]?.role, "user");
    assertEquals(recordedMessages[0]?.image_paths, ["image.png"]);
    assertEquals(recordedMessages[1]?.role, "assistant");
    assertEquals(recordedMessages[1]?.sender_type, "assistant");
    assertEquals(session.current()?.id, "created-1");
    assertEquals(session.current()?.messageCount, 2);

    const removed = await session.remove("created-1");
    assertEquals(removed, true);
    assertEquals(session.current(), null);
  });

  clearCurrentSession();
});

Deno.test("session API hides cancelled transcript rows on resume and export", async () => {
  const runtimeSession = {
    id: "sess-cancelled",
    title: "Cancelled",
    created_at: "2026-03-07T00:00:00.000Z",
    updated_at: "2026-03-07T00:05:00.000Z",
    message_count: 4,
    session_version: 3,
    metadata: null,
  };
  const messages: MessageRow[] = [
    {
      id: 1,
      session_id: "sess-cancelled",
      order: 1,
      role: "user",
      content: "keep me",
      client_turn_id: "turn-1",
      request_id: "req-1",
      sender_type: "user",
      sender_detail: null,
      image_paths: null,
      tool_calls: null,
      tool_name: null,
      tool_call_id: null,
      cancelled: 0,
      created_at: "2026-03-07T00:00:00.000Z",
    },
    {
      id: 2,
      session_id: "sess-cancelled",
      order: 2,
      role: "assistant",
      content: "keep reply",
      client_turn_id: "turn-1",
      request_id: "req-1",
      sender_type: "assistant",
      sender_detail: null,
      image_paths: null,
      tool_calls: null,
      tool_name: null,
      tool_call_id: null,
      cancelled: 0,
      created_at: "2026-03-07T00:00:01.000Z",
    },
    {
      id: 3,
      session_id: "sess-cancelled",
      order: 3,
      role: "user",
      content: "cancel me",
      client_turn_id: "turn-2",
      request_id: "req-2",
      sender_type: "user",
      sender_detail: null,
      image_paths: null,
      tool_calls: null,
      tool_name: null,
      tool_call_id: null,
      cancelled: 0,
      created_at: "2026-03-07T00:00:02.000Z",
    },
    {
      id: 4,
      session_id: "sess-cancelled",
      order: 4,
      role: "assistant",
      content: "partial",
      client_turn_id: "turn-2",
      request_id: "req-2",
      sender_type: "assistant",
      sender_detail: null,
      image_paths: null,
      tool_calls: null,
      tool_name: null,
      tool_call_id: null,
      cancelled: 1,
      created_at: "2026-03-07T00:00:03.000Z",
    },
  ];

  clearCurrentSession();

  await withRuntimeHostServer(async (req) => {
    const url = new URL(req.url);

    if (url.pathname === "/api/sessions/sess-cancelled/messages") {
      return Response.json({
        messages,
        total: messages.length,
        has_more: false,
        session_version: 3,
      });
    }

    if (url.pathname === "/api/sessions/sess-cancelled") {
      return Response.json(runtimeSession);
    }

    return new Response("Not found", { status: 404 });
  }, async () => {
    const resumed = await session.resume("sess-cancelled");
    const exported = await session.export("sess-cancelled");

    assertEquals(
      resumed?.messages.map((message) => [message.role, message.content]),
      [
        ["user", "keep me"],
        ["assistant", "keep reply"],
      ],
    );
    assertStringIncludes(exported ?? "", "keep me");
    assertEquals((exported ?? "").includes("cancel me"), false);
  });

  clearCurrentSession();
});
