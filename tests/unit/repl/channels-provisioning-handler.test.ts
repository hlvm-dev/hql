import { assert, assertEquals } from "jsr:@std/assert";
import { flushChannelDiagnostics } from "../../../src/hlvm/channels/core/trace.ts";
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
