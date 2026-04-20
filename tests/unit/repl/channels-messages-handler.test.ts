import { assert, assertEquals } from "jsr:@std/assert";
import {
  handleMessagesInbound,
  handleMessagesOutbox,
} from "../../../src/hlvm/cli/repl/handlers/channels/messages.ts";
import * as bridge from "../../../src/hlvm/channels/messages/bridge.ts";
import type {
  ChannelMessage,
  ChannelReply,
  ChannelTransportContext,
} from "../../../src/hlvm/channels/core/types.ts";

function buildFakeContext(): {
  ctx: ChannelTransportContext;
  received: ChannelMessage[];
  statusCalls: unknown[];
  updateConfigCalls: unknown[];
} {
  const received: ChannelMessage[] = [];
  const statusCalls: unknown[] = [];
  const updateConfigCalls: unknown[] = [];
  return {
    received,
    statusCalls,
    updateConfigCalls,
    ctx: {
      async receive(message) {
        received.push(message);
      },
      setStatus(status) {
        statusCalls.push(status);
      },
      async updateConfig(patch) {
        updateConfigCalls.push(patch);
      },
    },
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://test.local/api/channels/messages/inbound", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("handler: POST inbound returns 202 and forwards to bridge", async () => {
  bridge.resetForTesting();
  const { ctx, received } = buildFakeContext();
  bridge.setActiveContext(ctx);

  const res = await handleMessagesInbound(
    jsonRequest({
      remoteId: "approved",
      text: "hello",
      sender: { id: "approved", display: "Alice" },
    }),
  );

  assertEquals(res.status, 202);
  const body = await res.json();
  assertEquals(body, { accepted: true });
  assertEquals(received.length, 1);
  assertEquals(received[0], {
    channel: "messages",
    remoteId: "approved",
    text: "hello",
    sender: { id: "approved", display: "Alice" },
    raw: undefined,
  });

  bridge.resetForTesting();
});

Deno.test("handler: POST inbound returns 409 when no active context", async () => {
  bridge.resetForTesting();

  const res = await handleMessagesInbound(
    jsonRequest({ remoteId: "approved", text: "hello" }),
  );

  assertEquals(res.status, 409);
  const body = await res.json();
  assert(typeof body.error === "string" && body.error.length > 0);

  bridge.resetForTesting();
});

Deno.test("handler: POST inbound rejects missing remoteId with 400", async () => {
  bridge.resetForTesting();
  const { ctx } = buildFakeContext();
  bridge.setActiveContext(ctx);

  const res = await handleMessagesInbound(
    jsonRequest({ text: "hello" }),
  );

  assertEquals(res.status, 400);
  bridge.resetForTesting();
});

Deno.test("handler: POST inbound rejects missing text with 400", async () => {
  bridge.resetForTesting();
  const { ctx } = buildFakeContext();
  bridge.setActiveContext(ctx);

  const res = await handleMessagesInbound(
    jsonRequest({ remoteId: "approved" }),
  );

  assertEquals(res.status, 400);
  bridge.resetForTesting();
});

Deno.test("handler: POST inbound surfaces bridge errors as 500", async () => {
  bridge.resetForTesting();
  // Active context whose receive() throws.
  bridge.setActiveContext({
    async receive() {
      throw new Error("boom");
    },
    setStatus() {},
    async updateConfig() {},
  });

  const res = await handleMessagesInbound(
    jsonRequest({ remoteId: "approved", text: "hello" }),
  );

  assertEquals(res.status, 500);
  const body = await res.json();
  assert(typeof body.error === "string" && body.error.includes("boom"));

  bridge.resetForTesting();
});

Deno.test("handler: POST inbound rejects malformed JSON with 400", async () => {
  bridge.resetForTesting();
  const { ctx, received } = buildFakeContext();
  bridge.setActiveContext(ctx);

  const req = new Request("http://test.local/api/channels/messages/inbound", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not-json",
  });
  const res = await handleMessagesInbound(req);
  assertEquals(res.status, 400);
  // Malformed bodies must never reach the bridge.
  assertEquals(received.length, 0);

  bridge.resetForTesting();
});

Deno.test({
  name: "handler: GET outbox streams SSE-framed reply events",
  // createSSEResponse installs a 30s heartbeat interval; cleanup fires
  // on req.signal abort (see below). Disable op/resource sanitization
  // because the interval exists for the lifetime of the request.
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    bridge.resetForTesting();

    const aborter = new AbortController();
    const req = new Request(
      "http://test.local/api/channels/messages/outbox",
      { signal: aborter.signal },
    );
    const res = handleMessagesOutbox(req);

    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Drain the initial `retry:` preamble so our assertion lands on the
    // reply event we emit below.
    const preamble = await reader.read();
    assert(decoder.decode(preamble.value!).includes("retry:"));

    // Yield so setup() runs and subscribeOutbox registers the listener.
    await new Promise((r) => setTimeout(r, 5));

    const reply: ChannelReply = {
      channel: "messages",
      remoteId: "approved",
      sessionId: "channel:messages:approved",
      text: "Echo: hello",
    };
    bridge.emitOutbox(reply);

    const chunk = await reader.read();
    const raw = decoder.decode(chunk.value!);
    assert(raw.startsWith("id: 1\n"), `expected id: 1 prefix, got ${raw}`);
    assert(
      raw.includes("event: messages_outbox\n"),
      `missing messages_outbox event in ${raw}`,
    );
    assert(raw.includes(`"text":"Echo: hello"`));
    assert(raw.includes(`"remoteId":"approved"`));
    assert(raw.endsWith("\n\n"));

    // Abort triggers createSSEResponse's cleanup: clearInterval +
    // teardown() (which unsubscribes from bridge).
    aborter.abort();
    await reader.cancel().catch(() => {});
    bridge.resetForTesting();
  },
});

Deno.test({
  name: "handler: GET outbox abort cleans up the subscriber",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    bridge.resetForTesting();

    const aborter = new AbortController();
    const req = new Request(
      "http://test.local/api/channels/messages/outbox",
      { signal: aborter.signal },
    );
    const res = handleMessagesOutbox(req);
    const reader = res.body!.getReader();

    await reader.read(); // consume preamble, triggers setup()
    await new Promise((r) => setTimeout(r, 5));

    // Abort triggers cleanup (clearInterval + unsubscribe).
    aborter.abort();
    await reader.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, 5));

    // After cleanup runs, emitOutbox must throw because the listener
    // was removed — no silent black hole.
    let threw = false;
    try {
      bridge.emitOutbox({
        channel: "messages",
        remoteId: "approved",
        sessionId: "channel:messages:approved",
        text: "after abort",
      });
    } catch (error) {
      threw = true;
      assert(
        error instanceof Error && error.message === "no outbox subscriber",
      );
    }
    assert(threw, "emitOutbox must throw after subscriber is cleaned up");

    bridge.resetForTesting();
  },
});
