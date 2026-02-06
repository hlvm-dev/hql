import { assertEquals, assert } from "jsr:@std/assert";
import { handleWireRequest } from "../../../src/hlvm/agent/wire.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

Deno.test("wire tools.list returns tool entries", async () => {
  const messages: unknown[] = [];
  const send = async (msg: unknown) => {
    messages.push(msg);
  };

  await handleWireRequest(
    { jsonrpc: "2.0", id: 1, method: "tools.list" },
    { workspace: getPlatform().process.cwd() },
    send,
  );

  const response = messages[0] as { result?: unknown };
  assert(Array.isArray(response.result));
});

Deno.test("wire agent.run with fixture returns final result and events", async () => {
  const messages: unknown[] = [];
  const send = async (msg: unknown) => {
    messages.push(msg);
  };

  const fixturePath = getPlatform().path.join("tests", "fixtures", "wire-fixture.json");

  await handleWireRequest(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "agent.run",
      params: { task: "wire test", llmFixture: fixturePath },
    },
    { workspace: getPlatform().process.cwd() },
    send,
  );

  const events = messages.filter((m) =>
    (m as { method?: string }).method === "agent.event"
  );
  const response = messages.find((m) =>
    (m as { id?: number }).id === 2
  ) as { result?: { final?: string } };

  assertEquals(response.result?.final, "Final answer: ok");
});
