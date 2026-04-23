import { assertEquals } from "jsr:@std/assert";
import {
  createTelegramProvisioningBridgeHandler,
} from "../../../src/hlvm/channels/telegram/provisioning-bridge-server.ts";
import {
  createTelegramProvisioningBridgeService,
} from "../../../src/hlvm/channels/telegram/provisioning-bridge-service.ts";
import { buildBearerHeader } from "../../../src/common/http/auth-headers.ts";

function jsonRequest(
  url: string,
  body: unknown,
  headers: HeadersInit = {},
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

Deno.test("telegram provisioning bridge server: exposes health, register, start, claim, and authenticated complete routes", async () => {
  const service = createTelegramProvisioningBridgeService({
    now: () => Date.parse("2026-04-21T00:00:00.000Z"),
  });
  const handler = createTelegramProvisioningBridgeHandler({
    authToken: "bridge-secret",
    service,
  });

  const health = await handler(new Request("https://provision.hlvm.dev/health"));
  assertEquals(health.status, 200);
  assertEquals(await health.json(), { ok: true });

  const register = await handler(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session", {
      sessionId: "session-1",
      claimToken: "claim-1",
      managerBotUsername: "hlvm_manager_bot",
      botName: "HLVM",
      botUsername: "hlvm_test_bot",
      expiresAt: "2026-04-21T00:10:00.000Z",
    }),
  );
  assertEquals(register.status, 201);

  const start = await handler(
    new Request("https://provision.hlvm.dev/telegram/start?session=session-1"),
  );
  assertEquals(start.status, 302);
  assertEquals(
    start.headers.get("location"),
    "https://t.me/newbot/hlvm_manager_bot/hlvm_test_bot?name=HLVM",
  );

  const unauthorizedComplete = await handler(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session/complete", {
      sessionId: "session-1",
      token: "123:abc",
    }),
  );
  assertEquals(unauthorizedComplete.status, 401);

  const complete = await handler(
    jsonRequest(
      "https://provision.hlvm.dev/api/telegram/provisioning/session/complete",
      {
        sessionId: "session-1",
        token: "123:abc",
      },
      buildBearerHeader("bridge-secret"),
    ),
  );
  assertEquals(complete.status, 200);

  const claim = await handler(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session/claim", {
      sessionId: "session-1",
      claimToken: "claim-1",
    }),
  );
  const claimed = await claim.json();
  assertEquals(claim.status, 200);
  assertEquals(claimed.token, "123:abc");
});

Deno.test("telegram provisioning bridge server: manager webhook completes a matching pending session", async () => {
  const service = createTelegramProvisioningBridgeService({
    now: () => Date.parse("2026-04-21T00:00:00.000Z"),
  });
  const handler = createTelegramProvisioningBridgeHandler({
    authToken: "bridge-secret",
    managerBotUsername: "hlvm_setup_helper_bot",
    managerBotToken: "manager-token",
    managerBotWebhookSecret: "manager-secret",
    managerBotApi: {
      async getManagedBotToken(token, managedBotUserId) {
        assertEquals(token, "manager-token");
        assertEquals(managedBotUserId, 9001);
        return "123:abc";
      },
    },
    service,
  });

  await handler(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session", {
      sessionId: "session-1",
      claimToken: "claim-1",
      managerBotUsername: "hlvm_setup_helper_bot",
      botName: "HLVM",
      botUsername: "TestHLVMBot",
      expiresAt: "2026-04-21T00:10:00.000Z",
    }),
  );

  const webhook = await handler(
    jsonRequest(
      "https://provision.hlvm.dev/api/telegram/manager/webhook",
      {
        update_id: 1,
        managed_bot: {
          user: { id: 42 },
          bot: { id: 9001, username: "TestHLVMBot" },
        },
      },
      { "X-Telegram-Bot-Api-Secret-Token": "manager-secret" },
    ),
  );

  assertEquals(webhook.status, 200);

  const claim = await handler(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session/claim", {
      sessionId: "session-1",
      claimToken: "claim-1",
    }),
  );
  const claimed = await claim.json();
  assertEquals(claim.status, 200);
  assertEquals(claimed.token, "123:abc");
});

Deno.test("telegram provisioning bridge server: manager webhook stores unmatched managed bot for later auto-adoption", async () => {
  const service = createTelegramProvisioningBridgeService({
    now: () => Date.parse("2026-04-21T00:00:00.000Z"),
  });
  const handler = createTelegramProvisioningBridgeHandler({
    authToken: "bridge-secret",
    managerBotUsername: "hlvm_setup_helper_bot",
    managerBotToken: "manager-token",
    managerBotWebhookSecret: "manager-secret",
    managerBotApi: {
      async getManagedBotToken(token, managedBotUserId) {
        assertEquals(token, "manager-token");
        assertEquals(managedBotUserId, 9002);
        return "123:xyz";
      },
    },
    service,
  });

  await handler(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session", {
      sessionId: "session-1",
      claimToken: "claim-1",
      managerBotUsername: "hlvm_setup_helper_bot",
      botName: "HLVM",
      botUsername: "hlvm_prefilled_bot",
      expiresAt: "2026-04-21T00:10:00.000Z",
    }),
  );

  const webhook = await handler(
    jsonRequest(
      "https://provision.hlvm.dev/api/telegram/manager/webhook",
      {
        update_id: 2,
        managed_bot: {
          user: { id: 77 },
          bot: { id: 9002, username: "hlvm_jssbot" },
        },
      },
      { "X-Telegram-Bot-Api-Secret-Token": "manager-secret" },
    ),
  );
  const webhookBody = await webhook.json();

  assertEquals(webhook.status, 200);
  assertEquals(webhookBody.matched, false);

  const claim = await handler(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session/claim", {
      sessionId: "session-1",
      claimToken: "claim-1",
    }),
  );
  const claimed = await claim.json();
  assertEquals(claim.status, 200);
  assertEquals(claimed.token, "123:xyz");
  assertEquals(claimed.username, "hlvm_jssbot");
});

Deno.test("telegram provisioning bridge server: returns 404 for unknown routes", async () => {
  const handler = createTelegramProvisioningBridgeHandler({
    authToken: "bridge-secret",
  });

  const response = await handler(new Request("https://provision.hlvm.dev/nope"));
  assertEquals(response.status, 404);
});
