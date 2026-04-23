import { assertEquals, assertRejects } from "jsr:@std/assert";
import { createTelegramTransport } from "../../../src/hlvm/channels/telegram/transport.ts";
import type {
  ChannelMessage,
  ChannelStatus,
  ChannelTransportContext,
} from "../../../src/hlvm/channels/core/types.ts";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id: number | string };
    from?: { id: number; first_name?: string; last_name?: string; username?: string };
  };
}

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
  const statuses: Array<Partial<ChannelStatus> & Pick<ChannelStatus, "state">> = [];
  const patches: Array<Record<string, unknown>> = [];
  const context: ChannelTransportContext = {
    async receive(message) {
      received.push(message);
    },
    setStatus(status) {
      statuses.push(status);
    },
    async updateConfig(patch) {
      patches.push(patch as Record<string, unknown>);
    },
  };
  return { context, received, statuses, patches };
}

Deno.test("telegram transport: start requires direct mode and token", async () => {
  const { context } = createTestContext();

  const wrongMode = createTelegramTransport({
    enabled: true,
    transport: { mode: "relay", token: "123:abc" },
  });
  await assertRejects(
    () => wrongMode.start(context),
    Error,
    "supports only",
  );

  const missingToken = createTelegramTransport({
    enabled: true,
    transport: { mode: "direct" },
  });
  await assertRejects(
    () => missingToken.start(context),
    Error,
    "requires channels.telegram.transport.token",
  );
});

Deno.test("telegram transport: recognizes Telegram /start pair-code messages", () => {
  const transport = createTelegramTransport({
    enabled: true,
    transport: { mode: "direct", token: "123:abc" },
  });

  assertEquals(
    transport.matchesPairCode?.({
      channel: "telegram",
      remoteId: "1",
      text: "/start HLVM-1234",
    }, "1234"),
    true,
  );
  assertEquals(
    transport.matchesPairCode?.({
      channel: "telegram",
      remoteId: "1",
      text: "HLVM-1234",
    }, "1234"),
    true,
  );
  assertEquals(
    transport.matchesPairCode?.({
      channel: "telegram",
      remoteId: "1",
      text: "/start",
    }, "1234"),
    true,
  );
  assertEquals(
    transport.matchesPairCode?.({
      channel: "telegram",
      remoteId: "1",
      text: "/start hello",
    }, "1234"),
    false,
  );
});

Deno.test("telegram transport: polls updates, normalizes inbound messages, and persists state", async () => {
  let firstPoll = true;
  const pollOffsets: number[] = [];
  const sendCalls: Array<{ chatId: string; text: string }> = [];

  const transport = createTelegramTransport({
    enabled: true,
    transport: { mode: "direct", token: "123:abc", cursor: 0 },
  }, {
    api: {
      async getMe() {
        return { id: 99, username: "hlvm_x7f3_bot" };
      },
      async getUpdates(_token, offset, signal) {
        pollOffsets.push(offset);
        if (firstPoll) {
          firstPoll = false;
          return [{
            update_id: 41,
            message: {
              message_id: 7,
              text: "/start HLVM-1234",
              chat: { id: 555 },
              from: { id: 777, first_name: "Alice" },
            },
          } satisfies TelegramUpdate];
        }
        return await new Promise<TelegramUpdate[]>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
      async sendMessage(_token, chatId, text) {
        sendCalls.push({ chatId, text });
      },
    },
  });

  const { context, received, patches, statuses } = createTestContext();
  await transport.start(context);

  await waitFor(() =>
    received.length === 1 &&
    patches.some((patch) =>
      (patch.transport as { username?: string } | undefined)?.username ===
        "hlvm_x7f3_bot"
    ) &&
    patches.some((patch) =>
      (patch.transport as { cursor?: number } | undefined)?.cursor === 41
    )
  );

  assertEquals(pollOffsets[0], 1);
  assertEquals(received.length, 1);
  assertEquals(received[0].channel, "telegram");
  assertEquals(received[0].remoteId, "555");
  assertEquals(received[0].sender?.id, "777");
  assertEquals(received[0].sender?.display, "Alice");
  assertEquals(received[0].text, "/start HLVM-1234");
  assertEquals(statuses.at(-1)?.state, "connected");

  await transport.send({
    channel: "telegram",
    remoteId: "555",
    sessionId: "channel:telegram:555",
    text: "hi there",
  });
  assertEquals(sendCalls, [{ chatId: "555", text: "hi there" }]);

  await transport.stop();
});

Deno.test("telegram transport: refreshes persisted username when Telegram username changes", async () => {
  const transport = createTelegramTransport({
    enabled: true,
    transport: { mode: "direct", token: "123:abc", username: "old_hlvm_bot", cursor: 0 },
  }, {
    api: {
      async getMe() {
        return { id: 99, username: "hlvm_renamed_bot" };
      },
      async getUpdates(_token, _offset, signal) {
        return await new Promise<TelegramUpdate[]>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
      async sendMessage() {},
    },
  });

  const { context, patches } = createTestContext();
  await transport.start(context);

  await waitFor(() =>
    patches.some((patch) =>
      (patch.transport as { username?: string } | undefined)?.username ===
        "hlvm_renamed_bot"
    )
  );

  await transport.stop();
});
