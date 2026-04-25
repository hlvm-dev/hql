import { assertEquals, assertRejects } from "jsr:@std/assert";
import { flushChannelDiagnostics } from "../../../src/hlvm/channels/core/trace.ts";
import { createLineTransport } from "../../../src/hlvm/channels/line/transport.ts";
import type { LineProvisioningBridgeClient } from "../../../src/hlvm/channels/line/provisioning-bridge-client.ts";
import type {
  ChannelMessage,
  ChannelStatus,
  ChannelTransportContext,
} from "../../../src/hlvm/channels/core/types.ts";

function waitFor(
  predicate: () => boolean,
  timeoutMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error("timeout waiting for condition"));
        return;
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

function createTestContext() {
  const received: ChannelMessage[] = [];
  const statuses: Array<Partial<ChannelStatus> & Pick<ChannelStatus, "state">> =
    [];
  const context: ChannelTransportContext = {
    async receive(message) {
      received.push(message);
    },
    setStatus(status) {
      statuses.push(status);
    },
    async updateConfig() {},
  };
  return { context, received, statuses };
}

function sseMessage(input: {
  id: string;
  userId: string;
  text: string;
  timestamp?: number;
}): Uint8Array {
  const event = {
    id: input.id,
    type: "message",
    userId: input.userId,
    text: input.text,
    timestamp: input.timestamp ?? 1_776_537_600_000,
  };
  return new TextEncoder().encode(
    `id: ${input.id}\nevent: line_message\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

Deno.test("line transport: start requires relay mode and bridge credentials", async () => {
  const { context } = createTestContext();

  const wrongMode = createLineTransport({
    enabled: true,
    transport: { mode: "direct" },
  });
  await assertRejects(
    () => wrongMode.start(context),
    Error,
    "supports only",
  );

  const missingCredentials = createLineTransport({
    enabled: true,
    transport: { mode: "relay", bridgeUrl: "https://line-bridge.hlvm.dev" },
  });
  await assertRejects(
    () => missingCredentials.start(context),
    Error,
    "requires bridgeUrl, deviceId, and clientToken",
  );
  await flushChannelDiagnostics();
});

Deno.test("line transport: recognizes HLVM pair-code messages", async () => {
  const transport = createLineTransport({
    enabled: true,
    transport: {
      mode: "relay",
      bridgeUrl: "https://line-bridge.hlvm.dev",
      deviceId: "device-1",
      clientToken: "client-1",
    },
  }, {
    bridgeClient: {
      async registerSession() {
        throw new Error("not used");
      },
      async streamEvents() {
        throw new Error("not used");
      },
      async sendMessage() {
        throw new Error("not used");
      },
    },
  });

  assertEquals(
    transport.matchesPairCode?.({
      channel: "line",
      remoteId: "line-user-1",
      text: "HLVM-1234",
    }, "1234"),
    true,
  );
  assertEquals(
    transport.matchesPairCode?.({
      channel: "line",
      remoteId: "line-user-1",
      text: "hello",
    }, "1234"),
    false,
  );
  await flushChannelDiagnostics();
});

Deno.test("line transport: consumes bridge SSE, normalizes inbound messages, drops duplicate events, and sends replies", async () => {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const sendCalls: Array<{ to: string; text: string }> = [];
  const bridgeClient: LineProvisioningBridgeClient = {
    async registerSession() {
      throw new Error("not used");
    },
    async streamEvents(_input, signal) {
      const stream = new ReadableStream<Uint8Array>({
        start(nextController) {
          controller = nextController;
          signal.addEventListener(
            "abort",
            () => {
              try {
                nextController.close();
              } catch {
                // Already closed by the test.
              }
            },
            { once: true },
          );
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    },
    async sendMessage(input) {
      sendCalls.push({ to: input.to, text: input.text });
      return { ok: true };
    },
  };

  const transport = createLineTransport({
    enabled: true,
    transport: {
      mode: "relay",
      bridgeUrl: "https://line-bridge.hlvm.dev",
      deviceId: "device-1",
      clientToken: "client-1",
    },
  }, { bridgeClient });
  const { context, received, statuses } = createTestContext();

  await transport.start(context);
  await waitFor(() => !!controller && statuses.at(-1)?.state === "connected");

  controller!.enqueue(sseMessage({
    id: "evt-1",
    userId: "line-user-1",
    text: "HLVM-1234",
  }));
  controller!.enqueue(sseMessage({
    id: "evt-1",
    userId: "line-user-1",
    text: "HLVM-1234",
  }));

  await waitFor(() => received.length === 1);
  assertEquals(received[0].channel, "line");
  assertEquals(received[0].remoteId, "line-user-1");
  assertEquals(received[0].sender?.id, "line-user-1");
  assertEquals(received[0].text, "HLVM-1234");

  await transport.send({
    channel: "line",
    remoteId: "line-user-1",
    sessionId: "channel:line:line-user-1",
    text: "reply",
  });
  assertEquals(sendCalls, [{ to: "line-user-1", text: "reply" }]);

  await transport.stop();
  await flushChannelDiagnostics();
});
