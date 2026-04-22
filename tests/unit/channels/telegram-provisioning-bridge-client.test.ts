import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  createTelegramProvisioningBridgeClient,
} from "../../../src/hlvm/channels/telegram/provisioning-bridge-client.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.test("telegram provisioning bridge client: registers a session through the bridge boundary", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const client = createTelegramProvisioningBridgeClient("https://provision.hlvm.dev", {
    fetchRaw: async (url, options) => {
      requests.push({
        url,
        body: JSON.parse(String(options?.body)) as Record<string, unknown>,
      });
      return jsonResponse({
        sessionId: "session-1",
        state: "pending",
        managerBotUsername: "hlvm_manager_bot",
        botName: "HLVM",
        botUsername: "hlvm_test_bot",
        createUrl: "https://t.me/newbot/hlvm_manager_bot/hlvm_test_bot?name=HLVM",
        createdAt: "2026-04-21T00:00:00.000Z",
        expiresAt: "2026-04-21T00:10:00.000Z",
      }, 201);
    },
  });

  const session = await client.registerSession({
    sessionId: "session-1",
    claimToken: "claim-1",
    managerBotUsername: "hlvm_manager_bot",
    botName: "HLVM",
    botUsername: "hlvm_test_bot",
    expiresAt: "2026-04-21T00:10:00.000Z",
  });

  assertEquals(requests[0]?.url, "https://provision.hlvm.dev/api/telegram/provisioning/session");
  assertEquals(requests[0]?.body.claimToken, "claim-1");
  assertEquals(session.state, "pending");
});

Deno.test("telegram provisioning bridge client: maps structured non-success claim responses", async () => {
  const client = createTelegramProvisioningBridgeClient("https://provision.hlvm.dev", {
    fetchRaw: async () =>
      jsonResponse(
        { error: "Telegram provisioning session is not completed yet.", reason: "pending" },
        409,
      ),
  });

  const result = await client.claimSession({
    sessionId: "session-1",
    claimToken: "claim-1",
    waitMs: 250,
  });

  assertEquals(result, { ok: false, reason: "pending" });
});

Deno.test("telegram provisioning bridge client: throws for unexpected bridge errors", async () => {
  const client = createTelegramProvisioningBridgeClient("https://provision.hlvm.dev", {
    fetchRaw: async () => jsonResponse({ error: "bridge broke" }, 500),
  });

  await assertRejects(
    () =>
      client.claimSession({
        sessionId: "session-1",
        claimToken: "claim-1",
      }),
    Error,
    "bridge broke",
  );
});
