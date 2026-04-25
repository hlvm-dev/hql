import { assert, assertEquals } from "jsr:@std/assert";
import { DEFAULT_CONFIG } from "../../../src/common/config/types.ts";
import { flushChannelDiagnostics } from "../../../src/hlvm/channels/core/trace.ts";
import {
  createLineProvisioningService,
} from "../../../src/hlvm/channels/line/provisioning.ts";
import type { LineProvisioningBridgeClient } from "../../../src/hlvm/channels/line/provisioning-bridge-client.ts";
import {
  handleLineProvisioningCancel,
  handleLineProvisioningComplete,
  handleLineProvisioningCreate,
  handleLineProvisioningGet,
} from "../../../src/hlvm/cli/repl/handlers/channels/line-provisioning.ts";
import {
  handleChannelProvisioningCancel,
  handleChannelProvisioningComplete,
  handleChannelProvisioningCreate,
  handleChannelProvisioningGet,
} from "../../../src/hlvm/cli/repl/handlers/channels/provisioning.ts";

function routeHandlers() {
  return {
    telegram: {
      create: async () => Response.json({ created: true }, { status: 201 }),
      get: () => Response.json({ sessionId: "session-1" }, { status: 200 }),
      complete: async () => Response.json({ completed: true }, { status: 200 }),
      cancel: () => Response.json({ cancelled: true }, { status: 200 }),
    },
  };
}

function lineBridgeClient(): LineProvisioningBridgeClient {
  return {
    async registerSession(input) {
      return {
        sessionId: input.sessionId,
        state: "pending",
        pairCode: input.pairCode,
        officialAccountId: input.officialAccountId ?? "@hlvm",
        setupUrl: `https://line.me/R/oaMessage/${
          encodeURIComponent(input.officialAccountId ?? "@hlvm")
        }/?HLVM-${input.pairCode}`,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
      };
    },
    async streamEvents() {
      throw new Error("not used");
    },
    async sendMessage() {
      throw new Error("not used");
    },
  };
}

Deno.test("channel provisioning handler dispatches generic create route by channel", async () => {
  const res = await handleChannelProvisioningCreate(
    new Request(
      "http://test.local/api/channels/telegram/provisioning/session",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    ),
    { channel: "telegram" },
    { handlers: routeHandlers() },
  );

  assertEquals(res.status, 201);
  assertEquals(await res.json(), { created: true });
  await flushChannelDiagnostics();
});

Deno.test("channel provisioning handler funnels LINE through generic :channel route and real LINE provisioner", async () => {
  const service = createLineProvisioningService({
    provisioningBridgeBaseUrl: "https://line-bridge.hlvm.dev",
    officialAccountId: "@hlvm",
    now: () => Date.parse("2026-04-25T00:00:00.000Z"),
    randomId: (() => {
      const values = ["deviceabc", "clientabc", "sessionabc"];
      return () => values.shift() ?? "fallback";
    })(),
    randomCode: () => "1234",
    loadConfig: async () => DEFAULT_CONFIG,
    patchConfig: async () => DEFAULT_CONFIG,
    reconfigure: async () => {},
    getStatus: () => ({
      channel: "line",
      configured: true,
      enabled: true,
      state: "connected",
      mode: "relay",
      allowedIds: ["line-user-1"],
      lastError: null,
    }),
    armPairCode: () => {},
    disarmPairCode: () => {},
    bridgeClient: lineBridgeClient(),
  });
  const handlers = {
    line: {
      create: (req: Request) => handleLineProvisioningCreate(req, { service }),
      get: (req: Request) => handleLineProvisioningGet(req, { service }),
      complete: (req: Request) =>
        handleLineProvisioningComplete(req, { service }),
      cancel: (req: Request) => handleLineProvisioningCancel(req, { service }),
    },
  };

  const created = await handleChannelProvisioningCreate(
    new Request("http://test.local/api/channels/line/provisioning/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ officialAccountId: "@hlvm" }),
    }),
    { channel: "line" },
    { handlers },
  );
  const createdBody = await created.json();
  assertEquals(created.status, 201);
  assertEquals(createdBody.channel, "line");
  assertEquals(createdBody.sessionId, "sessionabc");
  assertEquals(createdBody.qrKind, "connect_account");

  const get = await handleChannelProvisioningGet(
    new Request("http://test.local/api/channels/line/provisioning/session"),
    { channel: "line" },
    { handlers },
  );
  assertEquals(get.status, 200);

  const completed = await handleChannelProvisioningComplete(
    new Request(
      "http://test.local/api/channels/line/provisioning/session/complete",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "sessionabc" }),
      },
    ),
    { channel: "line" },
    { handlers },
  );
  const completedBody = await completed.json();
  assertEquals(completed.status, 200);
  assertEquals(completedBody.session.channel, "line");
  assertEquals(completedBody.status.state, "connected");
  await flushChannelDiagnostics();
});

Deno.test("channel provisioning handler rejects unknown channel", async () => {
  const create = await handleChannelProvisioningCreate(
    new Request("http://test.local/api/channels/slack/provisioning/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    { channel: "slack" },
  );
  const get = await handleChannelProvisioningGet(
    new Request("http://test.local/api/channels/slack/provisioning/session"),
    { channel: "slack" },
  );
  const complete = await handleChannelProvisioningComplete(
    new Request(
      "http://test.local/api/channels/slack/provisioning/session/complete",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    ),
    { channel: "slack" },
  );
  const cancel = await handleChannelProvisioningCancel(
    new Request(
      "http://test.local/api/channels/slack/provisioning/session/cancel",
      {
        method: "POST",
      },
    ),
    { channel: "slack" },
  );

  for (const response of [create, get, complete, cancel]) {
    assertEquals(response.status, 404);
    const body = await response.json();
    assert(body.error.includes("Unsupported channel provisioning route"));
  }
  await flushChannelDiagnostics();
});
