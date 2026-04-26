import { Database } from "@db/sqlite";
import { assertEquals, assertRejects } from "jsr:@std/assert";
import { DEFAULT_CONFIG } from "../../../src/common/config/types.ts";
import {
  buildIMessageSetupUrl,
  readNewIMessageRows,
} from "../../../src/hlvm/channels/imessage/chatdb.ts";
import {
  selectIMessageAliasesFromMessagesPreferencesPayload,
  selectIMessageRecipientIdFromMacAccountsPayload,
} from "../../../src/hlvm/channels/imessage/account.ts";
import { createIMessageProvisioningService } from "../../../src/hlvm/channels/imessage/provisioning.ts";
import {
  buildSendScript,
  buildSendToChatScript,
  formatIMessageReply,
} from "../../../src/hlvm/channels/imessage/sender.ts";
import { createIMessageTransport } from "../../../src/hlvm/channels/imessage/transport.ts";
import type {
  ChannelMessage,
  ChannelReply,
  ChannelStatus,
  ChannelTransportContext,
} from "../../../src/hlvm/channels/core/types.ts";
import { flushChannelDiagnostics } from "../../../src/hlvm/channels/core/trace.ts";

function createMessagesFixture(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE handle (
      ROWID INTEGER PRIMARY KEY,
      id TEXT NOT NULL
    );
    CREATE TABLE chat (
      ROWID INTEGER PRIMARY KEY,
      chat_identifier TEXT
    );
    CREATE TABLE chat_handle_join (
      chat_id INTEGER NOT NULL,
      handle_id INTEGER NOT NULL
    );
    CREATE TABLE chat_message_join (
      chat_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL
    );
    CREATE TABLE message (
      ROWID INTEGER PRIMARY KEY,
      text TEXT,
      is_from_me INTEGER,
      handle_id INTEGER,
      associated_message_type INTEGER,
      attributedBody BLOB,
      message_summary_info BLOB,
      date_retracted INTEGER,
      date_edited INTEGER,
      is_unsent INTEGER
    );
  `);
  db.prepare("INSERT INTO handle (ROWID, id) VALUES (?, ?)").run(
    1,
    "user@example.com",
  );
  db.prepare("INSERT INTO handle (ROWID, id) VALUES (?, ?)").run(
    2,
    "other@example.com",
  );
  db.prepare("INSERT INTO handle (ROWID, id) VALUES (?, ?)").run(
    3,
    "+15551234567",
  );
  db.prepare("INSERT INTO chat (ROWID, chat_identifier) VALUES (?, ?)").run(
    10,
    "user@example.com",
  );
  db.prepare("INSERT INTO chat (ROWID, chat_identifier) VALUES (?, ?)").run(
    20,
    "other@example.com",
  );
  db.prepare("INSERT INTO chat (ROWID, chat_identifier) VALUES (?, ?)").run(
    30,
    "+15551234567",
  );
  db.prepare("INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)")
    .run(10, 1);
  db.prepare("INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)")
    .run(20, 2);
  db.prepare("INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)")
    .run(30, 3);
  return db;
}

function insertMessage(
  db: Database,
  input: {
    rowId: number;
    chatId: number;
    text: string | null;
    isFromMe?: number;
    handleId?: number;
    associatedMessageType?: number;
    attributedBody?: Uint8Array | null;
    messageSummaryInfo?: Uint8Array | null;
    dateRetracted?: number;
    dateEdited?: number;
    isUnsent?: number;
  },
): void {
  db.prepare(`
    INSERT INTO message (
      ROWID,
      text,
      is_from_me,
      handle_id,
      associated_message_type,
      attributedBody,
      message_summary_info,
      date_retracted,
      date_edited,
      is_unsent
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.rowId,
    input.text,
    input.isFromMe ?? 0,
    input.handleId ?? 1,
    input.associatedMessageType ?? 0,
    input.attributedBody ?? null,
    input.messageSummaryInfo ?? null,
    input.dateRetracted ?? 0,
    input.dateEdited ?? 0,
    input.isUnsent ?? 0,
  );
  db.prepare(
    "INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)",
  ).run(
    input.chatId,
    input.rowId,
  );
}

function makeAttributedBodyFixture(text: string): Uint8Array {
  const prefix = new TextEncoder().encode("NSString");
  const body = new TextEncoder().encode(text);
  return new Uint8Array([...prefix, body.length, ...body]);
}

Deno.test("imessage chatdb: reads only new inbound text from bound self-thread", () => {
  const db = createMessagesFixture();
  try {
    insertMessage(db, { rowId: 1, chatId: 10, text: "old" });
    insertMessage(db, { rowId: 2, chatId: 10, text: "hello" });
    insertMessage(db, { rowId: 3, chatId: 10, text: "from me", isFromMe: 1 });
    insertMessage(db, {
      rowId: 4,
      chatId: 10,
      text: "tapback",
      associatedMessageType: 2000,
    });
    insertMessage(db, { rowId: 5, chatId: 10, text: "edited", dateEdited: 1 });
    insertMessage(db, { rowId: 6, chatId: 20, text: "other", handleId: 2 });
    insertMessage(db, {
      rowId: 7,
      chatId: 10,
      text: "summary-backed normal text",
      messageSummaryInfo: new Uint8Array([1, 2, 3]),
    });

    const result = readNewIMessageRows(db, {
      recipientId: "user@example.com",
      recipientIds: ["user@example.com"],
      cursor: 1,
    });

    assertEquals(result.chatId, 10);
    assertEquals(result.cursor, 7);
    assertEquals(result.rows.map((row) => row.text), [
      "hello",
      "from me",
      "summary-backed normal text",
    ]);
    assertEquals(result.rows.map((row) => row.isFromMe), [false, true, false]);
  } finally {
    db.close();
  }
});

Deno.test("imessage chatdb: follows alias thread only after it is explicitly bound", () => {
  const db = createMessagesFixture();
  try {
    insertMessage(db, {
      rowId: 8,
      chatId: 30,
      text: "phone self",
      handleId: 3,
    });

    const result = readNewIMessageRows(db, {
      recipientId: "user@example.com",
      recipientIds: ["user@example.com", "+15551234567"],
      cursor: 7,
      chatId: 30,
    });

    assertEquals(result.chatId, 30);
    assertEquals(result.cursor, 8);
    assertEquals(result.rows.map((row) => row.text), ["phone self"]);
  } finally {
    db.close();
  }
});

Deno.test("imessage chatdb: unbound reader accepts every configured self-alias chat", () => {
  const db = createMessagesFixture();
  try {
    insertMessage(db, {
      rowId: 8,
      chatId: 30,
      text: "newer phone alias",
      handleId: 3,
    });
    insertMessage(db, {
      rowId: 9,
      chatId: 10,
      text: "primary email",
      handleId: 1,
    });

    const result = readNewIMessageRows(db, {
      recipientId: "user@example.com",
      recipientIds: ["user@example.com", "+15551234567"],
      cursor: 7,
    });

    assertEquals(result.chatId, 10);
    assertEquals(result.cursor, 9);
    assertEquals(result.rows.map((row) => row.text), [
      "newer phone alias",
      "primary email",
    ]);
  } finally {
    db.close();
  }
});

Deno.test("imessage chatdb: accepts configured self-alias chats after a chatId exists", () => {
  const db = createMessagesFixture();
  try {
    insertMessage(db, {
      rowId: 8,
      chatId: 10,
      text: "bound self",
      handleId: 1,
    });
    insertMessage(db, {
      rowId: 9,
      chatId: 30,
      text: "phone alias self",
      handleId: 3,
    });
    insertMessage(db, {
      rowId: 10,
      chatId: 20,
      text: "not self",
      handleId: 2,
    });

    const result = readNewIMessageRows(db, {
      recipientId: "user@example.com",
      recipientIds: ["user@example.com", "+15551234567"],
      cursor: 7,
      chatId: 10,
    });

    assertEquals(result.chatId, 30);
    assertEquals(result.cursor, 9);
    assertEquals(result.rows.map((row) => row.text), [
      "bound self",
      "phone alias self",
    ]);
  } finally {
    db.close();
  }
});

Deno.test("imessage chatdb: preserves attributedBody when text is null", () => {
  const db = createMessagesFixture();
  try {
    const attributedBody = makeAttributedBodyFixture("attributed fallback");
    insertMessage(db, {
      rowId: 8,
      chatId: 10,
      text: null,
      attributedBody,
    });

    const result = readNewIMessageRows(db, {
      recipientId: "user@example.com",
      recipientIds: ["user@example.com"],
      cursor: 7,
      chatId: 10,
    });

    assertEquals(result.cursor, 8);
    assertEquals(result.rows.map((row) => row.text), [""]);
    assertEquals(result.rows.map((row) => row.attributedBody), [
      attributedBody,
    ]);
  } finally {
    db.close();
  }
});

Deno.test("imessage provisioning: enables local channel and returns recipient-only QR URL", async () => {
  const patches: unknown[] = [];
  let reconfigured = false;
  const service = createIMessageProvisioningService({
    loadConfig: async () => ({ ...DEFAULT_CONFIG, channels: {} }),
    patchConfig: async (patch) => {
      patches.push(patch);
      return { ...DEFAULT_CONFIG, channels: {} };
    },
    reconfigure: async () => {
      reconfigured = true;
    },
    getStatus: () => ({
      channel: "imessage",
      configured: true,
      enabled: true,
      state: "connected",
      mode: "local",
      allowedIds: ["user@example.com"],
      lastError: null,
    }),
    reportStatus: () => {},
    now: () => 1_700_000_000_000,
    randomId: () => "session-id",
    readLatestCursor: () => 42,
    isMacOS: () => true,
  });

  const session = await service.createSession({
    recipientId: "user@example.com",
  });

  assertEquals(session.channel, "imessage");
  assertEquals(session.qrKind, "open_bot");
  assertEquals(session.setupUrl, buildIMessageSetupUrl("user@example.com"));
  assertEquals(session.state, "completed");
  assertEquals(reconfigured, true);
  assertEquals(patches, [{
    channels: {
      imessage: {
        enabled: true,
        allowedIds: ["user@example.com"],
        transport: {
          mode: "local",
          recipientId: "user@example.com",
          recipientIds: ["user@example.com"],
          cursor: 42,
          chatId: null,
          attributionMarker: "🤖",
        },
      },
    },
  }]);
});

Deno.test("imessage provisioning: uses Messages aliases ahead of stale existing config", async () => {
  const patches: unknown[] = [];
  const service = createIMessageProvisioningService({
    loadConfig: async () => ({
      ...DEFAULT_CONFIG,
      channels: {
        imessage: {
          enabled: true,
          allowedIds: ["old@example.com"],
          transport: {
            mode: "local",
            recipientId: "old@example.com",
            chatId: 99,
          },
        },
      },
    }),
    patchConfig: async (patch) => {
      patches.push(patch);
      return { ...DEFAULT_CONFIG, channels: {} };
    },
    reconfigure: async () => {},
    getStatus: () => null,
    reportStatus: () => {},
    now: () => 1_700_000_000_000,
    randomId: () => "session-id",
    readLatestCursor: () => 11,
    resolveDefaultIdentity: () => ({
      recipientId: "+15551234567",
      recipientIds: ["+15551234567", "user@example.com"],
    }),
    isMacOS: () => true,
  });

  const session = await service.createSession();

  assertEquals(session.recipientId, "+15551234567");
  assertEquals(patches, [{
    channels: {
      imessage: {
        enabled: true,
        allowedIds: ["+15551234567", "user@example.com"],
        transport: {
          mode: "local",
          recipientId: "+15551234567",
          recipientIds: ["+15551234567", "user@example.com"],
          cursor: 11,
          chatId: null,
          attributionMarker: "🤖",
        },
      },
    },
  }]);
});

Deno.test("imessage provisioning: resolves recipient from macOS Messages account payload", () => {
  assertEquals(
    selectIMessageRecipientIdFromMacAccountsPayload({
      Accounts: [
        {
          AccountID: "icloud-only@example.com",
          Services: [{ Name: "MAIL", ServiceID: "com.apple.Dataclass.Mail" }],
        },
        {
          AccountID: "user@example.com",
          Services: [{
            Name: "MESSAGES",
            ServiceID: "com.apple.Dataclass.Messages",
          }],
        },
      ],
    }),
    "user@example.com",
  );
});

Deno.test("imessage provisioning: extracts selected Messages aliases", () => {
  assertEquals(
    selectIMessageAliasesFromMessagesPreferencesPayload({
      "IMD-IDS-Aliases": {
        selectedAliases: ["+15551234567", "user@example.com"],
        allAliases: ["ignored@example.com"],
      },
    }),
    ["+15551234567", "user@example.com"],
  );
});

Deno.test("imessage provisioning: auto-discovered recipient works without request body", async () => {
  const patches: unknown[] = [];
  const service = createIMessageProvisioningService({
    loadConfig: async () => ({ ...DEFAULT_CONFIG, channels: {} }),
    patchConfig: async (patch) => {
      patches.push(patch);
      return { ...DEFAULT_CONFIG, channels: {} };
    },
    reconfigure: async () => {},
    getStatus: () => null,
    reportStatus: () => {},
    now: () => 1_700_000_000_000,
    randomId: () => "session-id",
    readLatestCursor: () => 7,
    resolveDefaultRecipientId: () => "auto@example.com",
    isMacOS: () => true,
  });

  const session = await service.createSession();

  assertEquals(session.recipientId, "auto@example.com");
  assertEquals(session.setupUrl, buildIMessageSetupUrl("auto@example.com"));
  assertEquals(patches, [{
    channels: {
      imessage: {
        enabled: true,
        allowedIds: ["auto@example.com"],
        transport: {
          mode: "local",
          recipientId: "auto@example.com",
          recipientIds: ["auto@example.com"],
          cursor: 7,
          chatId: null,
          attributionMarker: "🤖",
        },
      },
    },
  }]);
});

Deno.test("imessage sender: formats visible attribution and escapes AppleScript strings", () => {
  assertEquals(formatIMessageReply("hello", "🤖"), "🤖 hello");
  assertEquals(
    buildSendScript("user@example.com", 'hi "quoted" \\ path'),
    [
      'tell application "Messages"',
      "set targetService to first service whose service type = iMessage",
      'set targetBuddy to buddy "user@example.com" of targetService',
      'send "hi \\"quoted\\" \\\\ path" to targetBuddy',
      "end tell",
    ].join("\n"),
  );
  assertEquals(
    buildSendToChatScript("user@example.com", "hello"),
    [
      'tell application "Messages"',
      'set targetChat to chat id "any;-;user@example.com"',
      'send "hello" to targetChat',
      "end tell",
    ].join("\n"),
  );
});

Deno.test("imessage transport: requires configured local recipient", async () => {
  const transport = createIMessageTransport({
    enabled: true,
    transport: { mode: "local" },
  }, {
    isMacOS: () => true,
  });
  const context: ChannelTransportContext = {
    async receive(_message: ChannelMessage) {},
    setStatus(
      _status: Partial<ChannelStatus> & Pick<ChannelStatus, "state">,
    ) {},
    async updateConfig() {},
  };

  await assertRejects(
    () => transport.start(context),
    Error,
    "recipientId",
  );
});

Deno.test("imessage transport: replies to the exact inbound Messages chat", async () => {
  const sends: Array<{ kind: "buddy" | "chat"; id: string; text: string }> = [];
  const transport = createIMessageTransport({
    enabled: true,
    transport: {
      mode: "local",
      recipientId: "+15551234567",
      recipientIds: ["+15551234567", "user@example.com"],
      attributionMarker: "🤖",
    },
  }, {
    isMacOS: () => true,
    sender: {
      async send(recipientId, text) {
        sends.push({ kind: "buddy", id: recipientId, text });
      },
      async sendToChat(chatIdentifier, text) {
        sends.push({ kind: "chat", id: chatIdentifier, text });
      },
    },
  });

  await transport.send(
    {
      channel: "imessage",
      remoteId: "+15551234567",
      sessionId: "channel:imessage:+15551234567",
      text: "hello",
      replyTo: {
        chatIdentifier: "user@example.com",
        handleId: "user@example.com",
      },
    } satisfies ChannelReply,
  );
  await flushChannelDiagnostics();

  assertEquals(sends, [{
    kind: "chat",
    id: "user@example.com",
    text: "🤖 hello",
  }]);
});
