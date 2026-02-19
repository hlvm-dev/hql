/**
 * MCP Conformance: Robustness Tests
 *
 * Verifies client resilience against edge cases:
 * notification handler crashes, transport send failures,
 * pagination, resource templates, progress notifications, subscribe/unsubscribe.
 */

import { assertEquals } from "jsr:@std/assert";
import { createMockClient, MockTransport } from "./_helpers.ts";
import { McpClient } from "../../../src/hlvm/agent/mcp/client.ts";

// ============================================================
// Bug 3: Notification handler throws — client survives
// ============================================================

Deno.test("conformance/robustness: notification-handler-crash", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  // Register a handler that throws
  client.onNotification("notifications/progress", () => {
    throw new Error("Handler exploded!");
  });

  // Inject the notification
  transport.injectMessage({
    jsonrpc: "2.0",
    method: "notifications/progress",
    params: { progressToken: "t1", progress: 50, total: 100 },
  });

  // Client should still be alive — request should work
  transport.onMethod("ping", (msg) => ({
    jsonrpc: "2.0",
    id: msg.id!,
    result: {},
  }));
  await client.ping();

  await client.close();
});

// ============================================================
// Bug 4: sendError/sendResponse failure — no unhandled rejection
// ============================================================

Deno.test("conformance/robustness: sendError-failure", async () => {
  const transport = new MockTransport();
  transport.setupInitialize();
  const client = new McpClient(
    { name: "mock", command: ["mock"] },
    transport,
  );
  await client.start();

  // Make transport fail on sends after a certain point
  const originalSend = transport.send.bind(transport);
  let sendCount = 0;
  transport.send = async (msg) => {
    sendCount++;
    // Let init/initialized through, fail subsequent sends
    if (sendCount > 3) {
      throw new Error("Transport broken");
    }
    return originalSend(msg);
  };

  // Inject a server request — the error response send will fail
  transport.injectMessage({
    jsonrpc: "2.0",
    id: 7777,
    method: "unknown/method",
    params: {},
  });

  // Wait for the async error response attempt
  await new Promise((r) => setTimeout(r, 50));

  // No unhandled rejection = success
  assertEquals(true, true, "transport send failure must not cause unhandled rejection");

  await client.close();
});

// ============================================================
// Pagination collects all pages correctly
// ============================================================

Deno.test("conformance/robustness: pagination-all-pages", async () => {
  const { client, transport } = createMockClient();

  transport.onMethod("tools/list", (msg) => {
    const params = msg.params as Record<string, unknown> | undefined;
    const cursor = params?.cursor as string | undefined;
    if (!cursor) {
      return {
        jsonrpc: "2.0",
        id: msg.id!,
        result: {
          tools: [{ name: "a" }],
          nextCursor: "p2",
        },
      };
    }
    if (cursor === "p2") {
      return {
        jsonrpc: "2.0",
        id: msg.id!,
        result: {
          tools: [{ name: "b" }],
          nextCursor: "p3",
        },
      };
    }
    return {
      jsonrpc: "2.0",
      id: msg.id!,
      result: { tools: [{ name: "c" }] },
    };
  });

  await client.start();
  const tools = await client.listTools();

  assertEquals(tools.length, 3, "must collect all 3 pages");
  assertEquals(tools[0].name, "a");
  assertEquals(tools[1].name, "b");
  assertEquals(tools[2].name, "c");

  await client.close();
});

// ============================================================
// listResourceTemplates uses correct method
// ============================================================

Deno.test("conformance/robustness: list-resource-templates", async () => {
  const { client, transport } = createMockClient({ resources: {} });

  transport.onMethod("resources/templates/list", (msg) => ({
    jsonrpc: "2.0",
    id: msg.id!,
    result: {
      resourceTemplates: [
        { uriTemplate: "file:///{name}", name: "files" },
      ],
    },
  }));

  await client.start();
  const templates = await client.listResourceTemplates();

  assertEquals(templates.length, 1);
  assertEquals(templates[0].uriTemplate, "file:///{name}");
  assertEquals(templates[0].name, "files");

  // Verify correct method was called
  const sent = transport.sentByMethod("resources/templates/list");
  assertEquals(sent.length, 1, "must call resources/templates/list");

  await client.close();
});

// ============================================================
// Progress notification dispatched to handler
// ============================================================

Deno.test("conformance/robustness: progress-notification", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  let progressReceived = false;
  let progressData: unknown = null;
  client.onNotification("notifications/progress", (params) => {
    progressReceived = true;
    progressData = params;
  });

  transport.injectMessage({
    jsonrpc: "2.0",
    method: "notifications/progress",
    params: {
      progressToken: "tok1",
      progress: 75,
      total: 100,
      message: "Almost done",
    },
  });

  assertEquals(progressReceived, true, "progress notification must be dispatched");
  const data = progressData as Record<string, unknown>;
  assertEquals(data.progressToken, "tok1");
  assertEquals(data.progress, 75);
  assertEquals(data.total, 100);

  await client.close();
});

// ============================================================
// Subscribe/unsubscribe round-trip
// ============================================================

Deno.test("conformance/robustness: subscribe-unsubscribe", async () => {
  const { client, transport } = createMockClient({ resources: { subscribe: true } });

  transport.onMethod("resources/subscribe", (msg) => ({
    jsonrpc: "2.0",
    id: msg.id!,
    result: {},
  }));
  transport.onMethod("resources/unsubscribe", (msg) => ({
    jsonrpc: "2.0",
    id: msg.id!,
    result: {},
  }));

  await client.start();
  await client.subscribeResource("file:///test.md");
  await client.unsubscribeResource("file:///test.md");

  const sub = transport.sentByMethod("resources/subscribe");
  const unsub = transport.sentByMethod("resources/unsubscribe");
  assertEquals(sub.length, 1, "must send subscribe");
  assertEquals(unsub.length, 1, "must send unsubscribe");
  assertEquals(
    (sub[0].params as Record<string, unknown>).uri,
    "file:///test.md",
  );
  assertEquals(
    (unsub[0].params as Record<string, unknown>).uri,
    "file:///test.md",
  );

  await client.close();
});
