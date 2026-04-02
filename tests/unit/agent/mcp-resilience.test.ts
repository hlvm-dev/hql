import {
  assertEquals,
  assertRejects,
} from "jsr:@std/assert";
import { SdkMcpClient } from "../../../src/hlvm/agent/mcp/sdk-client.ts";

function makeClient() {
  return new SdkMcpClient({
    name: "test",
    command: ["echo", "ignored"],
  });
}

Deno.test("MCP resilience: session-expired tool listing reconnects once and succeeds", async () => {
  const client = makeClient();
  const reconnectEvents: string[] = [];
  let connectCalls = 0;
  let listCalls = 0;

  const fakeSdkClient = {
    listTools: async () => {
      listCalls++;
      if (listCalls === 1) {
        throw { status: 404, code: -32001, message: "session expired" };
      }
      return {
        tools: [{ name: "echo", description: "Echo" }],
      };
    },
    close: async () => {},
    getServerCapabilities: () => ({}),
    setRequestHandler: () => {},
    setNotificationHandler: () => {},
  };

  const instance = client as unknown as Record<string, unknown>;
  instance.client = fakeSdkClient;
  instance.createClient = () => fakeSdkClient;
  instance.connectClient = async () => {
    connectCalls++;
    (instance.connectionState as { connected: boolean }).connected = true;
  };

  client.onReconnect(() => reconnectEvents.push("reconnected"));

  const tools = await client.listTools();

  assertEquals(tools.map((tool) => tool.name), ["echo"]);
  assertEquals(connectCalls, 1);
  assertEquals(reconnectEvents, ["reconnected"]);
});

Deno.test("MCP resilience: transient failures back off exponentially before succeeding", async () => {
  const client = makeClient();
  const delays: number[] = [];
  let connectCalls = 0;
  let listCalls = 0;

  const fakeSdkClient = {
    listTools: async () => {
      listCalls++;
      if (listCalls === 1) {
        throw new Error("ECONNRESET");
      }
      return {
        tools: [{ name: "echo", description: "Echo" }],
      };
    },
    close: async () => {},
    getServerCapabilities: () => ({}),
    setRequestHandler: () => {},
    setNotificationHandler: () => {},
  };

  const instance = client as unknown as Record<string, unknown>;
  instance.client = fakeSdkClient;
  instance.createClient = () => fakeSdkClient;
  instance.delayReconnect = async (ms: number) => {
    delays.push(ms);
  };
  instance.connectClient = async () => {
    connectCalls++;
    if (connectCalls < 5) {
      throw new Error("connection closed");
    }
    (instance.connectionState as { connected: boolean }).connected = true;
  };

  const tools = await client.listTools();

  assertEquals(tools.length, 1);
  assertEquals(connectCalls, 5);
  assertEquals(delays, [1000, 2000, 4000, 8000]);
});

Deno.test("MCP resilience: terminal auth errors stop after three strikes", async () => {
  const client = makeClient();
  const instance = client as unknown as Record<string, unknown>;
  const unauthorized = Object.assign(new Error("unauthorized"), { status: 401 });
  instance.client = {
    listTools: async () => {
      throw unauthorized;
    },
    close: async () => {},
    getServerCapabilities: () => ({}),
    setRequestHandler: () => {},
    setNotificationHandler: () => {},
  };

  await assertRejects(() => client.listTools(), Error, "unauthorized");
  await assertRejects(() => client.listTools(), Error, "unauthorized");
  await assertRejects(() => client.listTools(), Error, "unauthorized");
  await assertRejects(
    () => client.listTools(),
    Error,
    "terminal error budget exceeded",
  );
});

Deno.test("MCP resilience: reconnect listeners fire after a successful transient recovery", async () => {
  const client = makeClient();
  const events: string[] = [];
  let listCalls = 0;

  const fakeSdkClient = {
    callTool: async () => {
      listCalls++;
      if (listCalls === 1) {
        throw new Error("socket hang up");
      }
      return { ok: true };
    },
    close: async () => {},
    getServerCapabilities: () => ({}),
    setRequestHandler: () => {},
    setNotificationHandler: () => {},
  };

  const instance = client as unknown as Record<string, unknown>;
  instance.client = fakeSdkClient;
  instance.createClient = () => fakeSdkClient;
  instance.connectClient = async () => {
    (instance.connectionState as { connected: boolean }).connected = true;
  };
  instance.delayReconnect = async () => {};
  client.onReconnect(() => events.push("fired"));

  const result = await client.callTool("echo", { message: "hi" });

  assertEquals(result, { ok: true });
  assertEquals(events, ["fired"]);
});
