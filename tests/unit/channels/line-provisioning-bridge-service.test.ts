import { assert, assertEquals } from "jsr:@std/assert";
import {
  createLineProvisioningBridgeHandler,
} from "../../../src/hlvm/channels/line/provisioning-bridge-server.ts";
import { flushChannelDiagnostics } from "../../../src/hlvm/channels/core/trace.ts";
import {
  createLineProvisioningBridgeService,
} from "../../../src/hlvm/channels/line/provisioning-bridge-service.ts";
import type { LineBridgeMessageEvent } from "../../../src/hlvm/channels/line/provisioning-bridge-protocol.ts";

function webhookPayload(
  text: string,
  options: {
    eventId: string;
    userId?: string;
    timestamp?: number;
  },
): unknown {
  return {
    events: [{
      type: "message",
      webhookEventId: options.eventId,
      timestamp: options.timestamp ?? 1_776_537_600_000,
      source: { userId: options.userId ?? "line-user-1" },
      message: { type: "text", text },
    }],
  };
}

function decodeSseEvent(chunk: Uint8Array): LineBridgeMessageEvent {
  const text = new TextDecoder().decode(chunk);
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  assert(dataLine, `missing SSE data line: ${text}`);
  return JSON.parse(dataLine.slice("data: ".length)) as LineBridgeMessageEvent;
}

async function hmacLineSignature(
  body: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  return btoa(String.fromCharCode(...digest));
}

Deno.test("line bridge: register -> webhook pair -> queued SSE delivery -> push reply", async () => {
  const fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const service = createLineProvisioningBridgeService({
    officialAccountId: "@hlvm",
    channelAccessToken: "line-access-token",
    now: () => Date.parse("2026-04-25T00:00:00.000Z"),
    fetchRaw: async (url, options) => {
      fetchCalls.push({
        url,
        body: JSON.parse(String(options?.body ?? "{}")) as Record<
          string,
          unknown
        >,
      });
      return new Response(null, { status: 200 });
    },
  });

  const session = await service.registerSession({
    sessionId: "session-1",
    deviceId: "device-1",
    clientToken: "client-1",
    pairCode: "1234",
    officialAccountId: "@hlvm",
    createdAt: "2026-04-25T00:00:00.000Z",
    expiresAt: "2026-04-25T00:10:00.000Z",
  });

  assertEquals(
    session.setupUrl,
    "https://line.me/R/oaMessage/%40hlvm/?HLVM-1234",
  );

  const pairResult = await service.ingestWebhook(
    webhookPayload("HLVM-1234", { eventId: "evt-pair", timestamp: 1 }),
  );
  const messageResult = await service.ingestWebhook(
    webhookPayload("hello", { eventId: "evt-message", timestamp: 2 }),
  );
  assertEquals(pairResult, { accepted: 1, delivered: 1 });
  assertEquals(messageResult, { accepted: 1, delivered: 1 });

  const abort = new AbortController();
  const response = await service.createEventStream({
    deviceId: "device-1",
    clientToken: "client-1",
    signal: abort.signal,
  });
  const reader = response.body!.getReader();
  const first = await reader.read();
  const second = await reader.read();
  abort.abort();
  await reader.cancel().catch(() => undefined);

  assertEquals(response.status, 200);
  assertEquals(decodeSseEvent(first.value!).id, "evt-pair");
  assertEquals(decodeSseEvent(second.value!).id, "evt-message");

  const sent = await service.sendMessage({
    deviceId: "device-1",
    clientToken: "client-1",
    to: "line-user-1",
    text: "reply",
  });
  assertEquals(sent, { ok: true });
  assertEquals(fetchCalls.length, 1);
  assertEquals(fetchCalls[0].url, "https://api.line.me/v2/bot/message/push");
  assertEquals(fetchCalls[0].body, {
    to: "line-user-1",
    messages: [{ type: "text", text: "reply" }],
  });
  await flushChannelDiagnostics();
});

Deno.test("line bridge: event stream rejects unauthorized devices", async () => {
  const service = createLineProvisioningBridgeService({
    officialAccountId: "@hlvm",
    channelAccessToken: "line-access-token",
  });

  const response = await service.createEventStream({
    deviceId: "unknown-device",
    clientToken: "wrong-token",
    signal: new AbortController().signal,
  });

  assertEquals(response.status, 401);
  await flushChannelDiagnostics();
});

Deno.test("line bridge server: webhook requires valid LINE signature before ingestion", async () => {
  const service = createLineProvisioningBridgeService({
    officialAccountId: "@hlvm",
    channelAccessToken: "line-access-token",
    now: () => Date.parse("2026-04-25T00:00:00.000Z"),
  });
  await service.registerSession({
    sessionId: "session-1",
    deviceId: "device-1",
    clientToken: "client-1",
    pairCode: "1234",
    officialAccountId: "@hlvm",
    createdAt: "2026-04-25T00:00:00.000Z",
    expiresAt: "2026-04-25T00:10:00.000Z",
  });

  const handler = createLineProvisioningBridgeHandler({
    officialAccountId: "@hlvm",
    channelAccessToken: "line-access-token",
    channelSecret: "line-secret",
    service,
  });
  const body = JSON.stringify(
    webhookPayload("HLVM-1234", { eventId: "evt-pair" }),
  );
  const signature = await hmacLineSignature(body, "line-secret");

  const rejected = await handler(
    new Request("https://bridge.hlvm.dev/api/line/webhook", {
      method: "POST",
      headers: { "x-line-signature": "wrong" },
      body,
    }),
  );
  assertEquals(rejected.status, 401);

  const accepted = await handler(
    new Request("https://bridge.hlvm.dev/api/line/webhook", {
      method: "POST",
      headers: { "x-line-signature": signature },
      body,
    }),
  );
  assertEquals(accepted.status, 200);
  assertEquals(await accepted.json(), { accepted: 1, delivered: 1 });
  await flushChannelDiagnostics();
});
