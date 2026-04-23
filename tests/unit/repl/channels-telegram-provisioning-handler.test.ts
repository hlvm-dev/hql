import { assert, assertEquals } from "jsr:@std/assert";
import type { TelegramProvisioningService } from "../../../src/hlvm/channels/telegram/provisioning.ts";
import {
  handleTelegramProvisioningCancel,
  handleTelegramProvisioningComplete,
  handleTelegramProvisioningCreate,
  handleTelegramProvisioningGet,
} from "../../../src/hlvm/cli/repl/handlers/channels/telegram-provisioning.ts";

function createSessionSnapshot() {
  return {
    channel: "telegram" as const,
    sessionId: "abc123",
    state: "pending" as const,
    setupUrl: "https://t.me/newbot/hlvm_manager_bot/hlvm_abc123_bot?name=HLVM",
    pairCode: "1234",
    managerBotUsername: "hlvm_manager_bot",
    botName: "HLVM",
    botUsername: "hlvm_abc123_bot",
    qrKind: "create_bot" as const,
    createUrl: "https://t.me/newbot/hlvm_manager_bot/hlvm_abc123_bot?name=HLVM",
    createdAt: "2026-04-21T00:00:00.000Z",
    expiresAt: "2026-04-21T00:10:00.000Z",
  };
}

function serviceStub(
  overrides: Partial<TelegramProvisioningService> = {},
): TelegramProvisioningService {
  return {
    channel: "telegram",
    createSession: async () => createSessionSnapshot(),
    getSession: () => createSessionSnapshot(),
    cancelSession: () => true,
    completeSession: async () => ({
      session: { ...createSessionSnapshot(), state: "completed" as const },
      status: {
        channel: "telegram",
        configured: true,
        enabled: true,
        state: "connected" as const,
        mode: "direct" as const,
        allowedIds: [],
        lastError: null,
      },
    }),
    ...overrides,
  };
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("telegram provisioning handler: create returns created session", async () => {
  const res = await handleTelegramProvisioningCreate(
    jsonRequest("http://test.local/api/channels/telegram/provisioning/session", {}),
    { service: serviceStub() },
  );

  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.sessionId, "abc123");
  assertEquals(body.pairCode, "1234");
});

Deno.test("telegram provisioning handler: get returns 404 when no session exists", async () => {
  const res = handleTelegramProvisioningGet(
    new Request("http://test.local/api/channels/telegram/provisioning/session"),
    { service: serviceStub({ getSession: () => null }) },
  );

  assertEquals(res.status, 404);
  const body = await res.json();
  assert(body.error.includes("No active Telegram provisioning session"));
});

Deno.test("telegram provisioning handler: complete validates required fields", async () => {
  const res = await handleTelegramProvisioningComplete(
    jsonRequest(
      "http://test.local/api/channels/telegram/provisioning/session/complete",
      { sessionId: "", token: "" },
    ),
    { service: serviceStub() },
  );

  assertEquals(res.status, 400);
});

Deno.test("telegram provisioning handler: complete returns 404 for unknown session", async () => {
  const res = await handleTelegramProvisioningComplete(
    jsonRequest(
      "http://test.local/api/channels/telegram/provisioning/session/complete",
      { sessionId: "missing", token: "123:abc" },
    ),
    { service: serviceStub({ completeSession: async () => null }) },
  );

  assertEquals(res.status, 404);
});

Deno.test("telegram provisioning handler: cancel returns cancellation result", async () => {
  const res = handleTelegramProvisioningCancel(
    new Request("http://test.local/api/channels/telegram/provisioning/session/cancel", {
      method: "POST",
    }),
    { service: serviceStub({ cancelSession: () => false }) },
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.cancelled, false);
});
