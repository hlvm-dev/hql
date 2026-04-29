import { assertEquals, assertExists } from "jsr:@std/assert";
import { RuntimeError } from "../../../src/common/error.ts";
import { ProviderErrorCode } from "../../../src/common/error-codes.ts";
import { AUTO_MODEL_ID } from "../../../src/common/config/types.ts";
import { getModelsDir } from "../../../src/common/paths.ts";
import { LOCAL_FALLBACK_IDENTITY } from "../../../src/hlvm/runtime/bootstrap-manifest.ts";
import { LOCAL_FALLBACK_MODEL_ID } from "../../../src/hlvm/runtime/local-fallback.ts";
import {
  createSession,
  getSession,
  insertMessage,
} from "../../../src/hlvm/store/conversation-store.ts";
import { __setListAllProviderModelsForTesting } from "../../../src/hlvm/agent/auto-select.ts";
import { disposeAllSessions } from "../../../src/hlvm/agent/agent-runner.ts";
import {
  type AgentEngine,
  resetAgentEngine,
  setAgentEngine,
} from "../../../src/hlvm/agent/engine.ts";
import {
  _resetActiveConversationForTesting,
  getActiveConversationSessionId,
} from "../../../src/hlvm/store/active-conversation.ts";
import { registerUploadedAttachment } from "../../../src/hlvm/attachments/service.ts";
import {
  handleAddMessage,
  handleDeleteMessage,
  handleGetMessage,
  handleGetMessages,
  handleUpdateMessage,
} from "../../../src/hlvm/cli/repl/handlers/messages.ts";
import {
  buildEvalAttachments,
  handleChat,
} from "../../../src/hlvm/cli/repl/handlers/chat.ts";
import { ai } from "../../../src/hlvm/api/ai.ts";
import { config } from "../../../src/hlvm/api/config.ts";
import { log } from "../../../src/hlvm/api/log.ts";
import {
  __testOnlyResetAgentReadyState,
  isAgentReady,
  markAgentReady,
} from "../../../src/hlvm/cli/repl/handlers/chat-session.ts";
import { registerProvider } from "../../../src/hlvm/providers/registry.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { setupStoreTestDb } from "../_shared/store-test-db.ts";
import { withTempHlvmDir } from "../helpers.ts";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(path: string): Request {
  return new Request(`http://localhost${path}`, { method: "GET" });
}

async function withDb(fn: () => Promise<void> | void): Promise<void> {
  const db = setupStoreTestDb();
  try {
    await fn();
  } finally {
    db.close();
  }
}

async function readNdjsonEvents(
  response: Response,
): Promise<Array<Record<string, unknown>>> {
  const text = await response.text();
  return text.trim().split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function seedDefaultLocalFallbackModel(): Promise<void> {
  const platform = getPlatform();
  const [name, tag = "latest"] = LOCAL_FALLBACK_IDENTITY.modelId.split(":");
  const manifestPath = platform.path.join(
    getModelsDir(),
    "manifests",
    "registry.ollama.ai",
    "library",
    name,
    tag,
  );
  await platform.fs.mkdir(platform.path.dirname(manifestPath), {
    recursive: true,
  });
  await platform.fs.writeTextFile(
    manifestPath,
    JSON.stringify({
      layers: [
        {
          mediaType: "application/vnd.ollama.image.model",
          digest: `${LOCAL_FALLBACK_IDENTITY.modelDigestPrefix}deadbeef`,
          size: LOCAL_FALLBACK_IDENTITY.publishedTotalSizeBytes,
        },
      ],
    }),
  );
}

function modelPerformance(modelId: string) {
  const [providerName, bareModelId] = modelId.split("/") as [string, string];
  return {
    providerName,
    modelId: bareModelId,
    latencyMs: 1,
  };
}

function statusError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

async function runAgentAutoDefaultFallbackScenario(
  errorFactory: () => unknown,
  expectedReason: string,
  primaryModel = "anthropic/claude-sonnet-4",
): Promise<void> {
  await withTempHlvmDir(async () => {
    await withDb(async () => {
      const [primaryProvider, primaryName] = primaryModel.split("/") as [
        string,
        string,
      ];
      __testOnlyResetAgentReadyState();
      await seedDefaultLocalFallbackModel();
      await config.reload();
      await config.patch({ approvedProviders: [primaryProvider] });
      const originalGet = ai.models.get;
      const llmCalls: string[] = [];
      const engine: AgentEngine = {
        createLLM: (config) => {
          const model = config.model ?? "";
          return async () => {
            llmCalls.push(model);
            if (model === primaryModel) {
              throw errorFactory();
            }
            if (model === LOCAL_FALLBACK_MODEL_ID) {
              return {
                content: "default local model answered through auto",
                toolCalls: [],
                performance: modelPerformance(LOCAL_FALLBACK_MODEL_ID),
              };
            }
            throw new Error(`unexpected model: ${model}`);
          };
        },
        createSummarizer: () => () => Promise.resolve(""),
      };

      __setListAllProviderModelsForTesting(async () => [{
        name: primaryName,
        displayName: primaryName,
        capabilities: ["chat", "tools"],
        contextWindow: 200_000,
        metadata: {
          provider: primaryProvider,
          cloud: true,
          apiKeyConfigured: true,
        },
      }]);
      (ai.models as { get: typeof ai.models.get }).get = (
        name: string,
        provider?: string,
      ) => {
        if (name === primaryName && provider === primaryProvider) {
          return Promise.resolve({
            name,
            displayName: primaryName,
            capabilities: ["chat", "tools"],
            contextWindow: 200_000,
            metadata: {
              provider,
              cloud: true,
              apiKeyConfigured: true,
            },
          });
        }
        if (LOCAL_FALLBACK_MODEL_ID === `${provider}/${name}`) {
          return Promise.resolve({
            name,
            displayName: "Default local model",
            capabilities: ["chat", "tools"],
            metadata: { provider },
          });
        }
        return Promise.resolve(null);
      };
      setAgentEngine(engine);

      try {
        const response = await handleChat(jsonRequest({
          mode: "agent",
          model: AUTO_MODEL_ID,
          stateless: true,
          trace: true,
          messages: [{
            role: "user",
            content: "answer from the default local fallback",
          }],
        }));

        assertEquals(response.status, 200);
        const events = await readNdjsonEvents(response);
        assertEquals(
          events.some((event) =>
            event.event === "token" &&
            event.text === "default local model answered through auto"
          ),
          true,
        );
        assertEquals(llmCalls, [
          primaryModel,
          LOCAL_FALLBACK_MODEL_ID,
        ]);

        const autoFallbackTrace = events.find((event) => {
          if (event.event !== "trace") return false;
          const trace = event.trace as { type?: string } | undefined;
          return trace?.type === "auto_fallback";
        })?.trace as
          | { fromModel?: string; toModel?: string; reason?: string }
          | undefined;
        assertExists(autoFallbackTrace);
        assertEquals(autoFallbackTrace.fromModel, primaryModel);
        assertEquals(autoFallbackTrace.toModel, LOCAL_FALLBACK_MODEL_ID);
        assertEquals(autoFallbackTrace.reason, expectedReason);

        const turnStats = events.find((event) =>
          event.event === "turn_stats"
        ) as { model_id?: string } | undefined;
        assertEquals(turnStats?.model_id, LOCAL_FALLBACK_MODEL_ID);
      } finally {
        resetAgentEngine();
        await disposeAllSessions();
        __setListAllProviderModelsForTesting(null);
        (ai.models as { get: typeof ai.models.get }).get = originalGet;
        __testOnlyResetAgentReadyState();
      }
    });
  });
}

async function runDirectChatAutoDefaultFallbackScenario(
  errorFactory: () => unknown,
  expectedReason: string,
  primaryModel = "anthropic/claude-sonnet-4",
): Promise<void> {
  await withTempHlvmDir(async () => {
    await withDb(async () => {
      const [primaryProvider, primaryName] = primaryModel.split("/") as [
        string,
        string,
      ];
      await seedDefaultLocalFallbackModel();
      await config.reload();
      await config.patch({ approvedProviders: [primaryProvider] });
      const originalGet = ai.models.get;
      const originalChat = ai.chat;
      const chatCalls: string[] = [];

      __setListAllProviderModelsForTesting(async () => [{
        name: primaryName,
        displayName: primaryName,
        capabilities: ["chat", "tools"],
        contextWindow: 200_000,
        metadata: {
          provider: primaryProvider,
          cloud: true,
          apiKeyConfigured: true,
        },
      }]);
      (ai.models as { get: typeof ai.models.get }).get = (
        name: string,
        provider?: string,
      ) => {
        if (name === primaryName && provider === primaryProvider) {
          return Promise.resolve({
            name,
            displayName: primaryName,
            capabilities: ["chat", "tools"],
            contextWindow: 200_000,
            metadata: {
              provider,
              cloud: true,
              apiKeyConfigured: true,
            },
          });
        }
        return Promise.resolve(null);
      };
      (ai as { chat: typeof ai.chat }).chat = async function* (
        _messages,
        options,
      ) {
        const model = options?.model ?? "";
        chatCalls.push(model);
        if (model === primaryModel) {
          throw errorFactory();
        }
        if (model === LOCAL_FALLBACK_MODEL_ID) {
          yield "default local chat fallback";
          return;
        }
        throw new Error(`unexpected model: ${model}`);
      };

      try {
        const response = await handleChat(jsonRequest({
          mode: "chat",
          model: AUTO_MODEL_ID,
          stateless: true,
          trace: true,
          messages: [{
            role: "user",
            content: "answer from direct chat fallback",
          }],
        }));

        assertEquals(response.status, 200);
        const events = await readNdjsonEvents(response);
        assertEquals(
          events.some((event) =>
            event.event === "token" &&
            event.text === "default local chat fallback"
          ),
          true,
        );
        assertEquals(chatCalls, [
          primaryModel,
          LOCAL_FALLBACK_MODEL_ID,
        ]);

        const autoFallbackTrace = events.find((event) => {
          if (event.event !== "trace") return false;
          const trace = event.trace as { type?: string } | undefined;
          return trace?.type === "auto_fallback";
        })?.trace as
          | { fromModel?: string; toModel?: string; reason?: string }
          | undefined;
        assertExists(autoFallbackTrace);
        assertEquals(autoFallbackTrace.fromModel, primaryModel);
        assertEquals(autoFallbackTrace.toModel, LOCAL_FALLBACK_MODEL_ID);
        assertEquals(autoFallbackTrace.reason, expectedReason);
      } finally {
        __setListAllProviderModelsForTesting(null);
        (ai.models as { get: typeof ai.models.get }).get = originalGet;
        (ai as { chat: typeof ai.chat }).chat = originalChat;
      }
    });
  });
}

const FALLBACK_WORTHY_PROVIDER_ERRORS: Array<{
  name: string;
  expectedReason: string;
  errorFactory: () => unknown;
  primaryModel?: string;
}> = [
  {
    name: "rate limit",
    expectedReason: "rate_limit",
    errorFactory: () => new Error("rate limit exceeded (429)"),
  },
  {
    name: "timeout",
    expectedReason: "timeout",
    errorFactory: () => new Error("request timed out after 30s"),
  },
  {
    name: "transient network failure",
    expectedReason: "transient",
    errorFactory: () => new Error("Connection reset (ECONNRESET)"),
  },
  {
    name: "cloud auth failure",
    expectedReason: "permanent",
    errorFactory: () =>
      statusError("HTTP 401 Unauthorized: invalid API key", 401),
  },
  {
    name: "OpenAI missing API key",
    expectedReason: "permanent",
    primaryModel: "openai/gpt-4o-mini",
    errorFactory: () =>
      new Error(
        "[hql3008] openai_api_key is not set. export it to use openai/ models.",
      ),
  },
  {
    name: "provider quota failure",
    expectedReason: "permanent",
    errorFactory: () =>
      new Error("exceeded your current quota; insufficient_quota"),
  },
  {
    name: "unknown provider failure",
    expectedReason: "unknown",
    errorFactory: () => new Error("provider returned an unclassified failure"),
  },
];

for (const scenario of FALLBACK_WORTHY_PROVIDER_ERRORS) {
  Deno.test(
    `handlers: agent auto ${scenario.name} falls through to default local model`,
    async () => {
      await runAgentAutoDefaultFallbackScenario(
        scenario.errorFactory,
        scenario.expectedReason,
        scenario.primaryModel,
      );
    },
  );

  Deno.test(
    `handlers: direct chat auto ${scenario.name} falls through to default local model`,
    async () => {
      await runDirectChatAutoDefaultFallbackScenario(
        scenario.errorFactory,
        scenario.expectedReason,
        scenario.primaryModel,
      );
    },
  );
}

Deno.test("handlers: direct chat auto invalid request does not fall back", async () => {
  await withTempHlvmDir(async () => {
    await withDb(async () => {
      await seedDefaultLocalFallbackModel();
      await config.reload();
      await config.patch({ approvedProviders: ["anthropic"] });
      const originalGet = ai.models.get;
      const originalChat = ai.chat;
      const chatCalls: string[] = [];

      __setListAllProviderModelsForTesting(async () => [{
        name: "claude-sonnet-4",
        displayName: "Claude Sonnet 4",
        capabilities: ["chat", "tools"],
        contextWindow: 200_000,
        metadata: {
          provider: "anthropic",
          cloud: true,
          apiKeyConfigured: true,
        },
      }]);
      (ai.models as { get: typeof ai.models.get }).get = (
        name: string,
        provider?: string,
      ) => {
        if (name === "claude-sonnet-4" && provider === "anthropic") {
          return Promise.resolve({
            name,
            displayName: "Claude Sonnet 4",
            capabilities: ["chat", "tools"],
            contextWindow: 200_000,
            metadata: { provider, cloud: true, apiKeyConfigured: true },
          });
        }
        return Promise.resolve(null);
      };
      (ai as { chat: typeof ai.chat }).chat = async function* (
        _messages,
        options,
      ) {
        const model = options?.model ?? "";
        chatCalls.push(model);
        if (model === "anthropic/claude-sonnet-4") {
          throw new Error("HTTP 400 Bad Request: invalid request");
        }
        if (model === LOCAL_FALLBACK_MODEL_ID) {
          yield "should not fallback";
          return;
        }
        throw new Error(`unexpected model: ${model}`);
      };

      try {
        const response = await handleChat(jsonRequest({
          mode: "chat",
          model: AUTO_MODEL_ID,
          stateless: true,
          trace: true,
          messages: [{ role: "user", content: "invalid request path" }],
        }));

        assertEquals(response.status, 200);
        const events = await readNdjsonEvents(response);
        assertEquals(chatCalls, ["anthropic/claude-sonnet-4"]);
        assertEquals(
          events.some((event) => event.event === "error"),
          true,
        );
        assertEquals(
          events.some((event) =>
            event.event === "trace" &&
            (event.trace as { type?: string } | undefined)?.type ===
              "auto_fallback"
          ),
          false,
        );
      } finally {
        __setListAllProviderModelsForTesting(null);
        (ai.models as { get: typeof ai.models.get }).get = originalGet;
        (ai as { chat: typeof ai.chat }).chat = originalChat;
      }
    });
  });
});

Deno.test("handlers: direct chat auto does not fall back after partial output", async () => {
  await withTempHlvmDir(async () => {
    await withDb(async () => {
      await seedDefaultLocalFallbackModel();
      await config.reload();
      await config.patch({ approvedProviders: ["anthropic"] });
      const originalGet = ai.models.get;
      const originalChat = ai.chat;
      const chatCalls: string[] = [];

      __setListAllProviderModelsForTesting(async () => [{
        name: "claude-sonnet-4",
        displayName: "Claude Sonnet 4",
        capabilities: ["chat", "tools"],
        contextWindow: 200_000,
        metadata: {
          provider: "anthropic",
          cloud: true,
          apiKeyConfigured: true,
        },
      }]);
      (ai.models as { get: typeof ai.models.get }).get = (
        name: string,
        provider?: string,
      ) => {
        if (name === "claude-sonnet-4" && provider === "anthropic") {
          return Promise.resolve({
            name,
            displayName: "Claude Sonnet 4",
            capabilities: ["chat", "tools"],
            contextWindow: 200_000,
            metadata: { provider, cloud: true, apiKeyConfigured: true },
          });
        }
        return Promise.resolve(null);
      };
      (ai as { chat: typeof ai.chat }).chat = async function* (
        _messages,
        options,
      ) {
        const model = options?.model ?? "";
        chatCalls.push(model);
        if (model === "anthropic/claude-sonnet-4") {
          yield "partial";
          throw new Error("Connection reset (ECONNRESET)");
        }
        if (model === LOCAL_FALLBACK_MODEL_ID) {
          yield "should not fallback";
          return;
        }
        throw new Error(`unexpected model: ${model}`);
      };

      try {
        const response = await handleChat(jsonRequest({
          mode: "chat",
          model: AUTO_MODEL_ID,
          stateless: true,
          trace: true,
          messages: [{ role: "user", content: "partial output path" }],
        }));

        assertEquals(response.status, 200);
        const events = await readNdjsonEvents(response);
        assertEquals(chatCalls, ["anthropic/claude-sonnet-4"]);
        assertEquals(
          events.some((event) =>
            event.event === "token" && event.text === "partial"
          ),
          true,
        );
        assertEquals(
          events.some((event) => event.event === "error"),
          true,
        );
        assertEquals(
          events.some((event) =>
            event.event === "trace" &&
            (event.trace as { type?: string } | undefined)?.type ===
              "auto_fallback"
          ),
          false,
        );
      } finally {
        __setListAllProviderModelsForTesting(null);
        (ai.models as { get: typeof ai.models.get }).get = originalGet;
        (ai as { chat: typeof ai.chat }).chat = originalChat;
      }
    });
  });
});

Deno.test("handlers: message listing supports pagination and cursor order in both directions", async () => {
  await withDb(async () => {
    const session = createSession("Messages");
    for (let i = 0; i < 5; i++) {
      insertMessage({
        session_id: session.id,
        role: "user",
        content: `Msg ${i}`,
      });
    }

    const asc = await (await handleGetMessages(
      getRequest("/api/chat/messages?limit=2&sort=asc"),
      { id: session.id },
    )).json();
    assertEquals(asc.messages.length, 2);
    assertEquals(asc.has_more, true);
    assertEquals(asc.total, 5);

    const afterAsc = await (await handleGetMessages(
      getRequest(
        "/api/chat/messages?after_order=2&limit=10&sort=asc",
      ),
      { id: session.id },
    )).json();
    assertEquals(afterAsc.messages.map((m: { order: number }) => m.order), [
      3,
      4,
      5,
    ]);

    const afterDesc = await (await handleGetMessages(
      getRequest(
        "/api/chat/messages?after_order=4&limit=10&sort=desc",
      ),
      { id: session.id },
    )).json();
    assertEquals(afterDesc.messages.map((m: { order: number }) => m.order), [
      3,
      2,
      1,
    ]);
  });
});

Deno.test("handlers: get message resolves numeric ids and client turn ids", async () => {
  await withDb(async () => {
    const session = createSession("Lookup");
    const numeric = insertMessage({
      session_id: session.id,
      role: "user",
      content: "Find me",
    });
    insertMessage({
      session_id: session.id,
      role: "assistant",
      content: "By turn ID",
      client_turn_id: "turn-123",
    });

    const numericResp = await handleGetMessage(
      getRequest(`/api/chat/messages/${numeric.id}`),
      { id: session.id, messageId: String(numeric.id) },
    );
    assertEquals(numericResp.status, 200);
    assertEquals((await numericResp.json()).content, "Find me");

    const turnResp = await handleGetMessage(
      getRequest("/api/chat/messages/turn-123"),
      { id: session.id, messageId: "turn-123" },
    );
    assertEquals(turnResp.status, 200);
    const turnBody = await turnResp.json();
    assertEquals(turnBody.content, "By turn ID");
    assertEquals(turnBody.client_turn_id, "turn-123");
  });
});

Deno.test("handlers: get message rejects invalid ids and wrong-session access", async () => {
  await withDb(async () => {
    const owner = createSession("Owner");
    const other = createSession("Other");
    const msg = insertMessage({
      session_id: owner.id,
      role: "user",
      content: "Owned",
    });

    assertEquals(
      (await handleGetMessage(
        getRequest("/api/chat/messages/not-a-number"),
        {
          id: owner.id,
          messageId: "not-a-number",
        },
      )).status,
      400,
    );
    assertEquals(
      (await handleGetMessage(
        getRequest(`/api/chat/messages/${msg.id}`),
        {
          id: other.id,
          messageId: String(msg.id),
        },
      )).status,
      404,
    );
  });
});

Deno.test("handlers: update message applies content, display content, and cancelled patches and rejects invalid targets", async () => {
  await withDb(async () => {
    const owner = createSession("Owner");
    const other = createSession("Other");
    const msg = insertMessage({
      session_id: owner.id,
      role: "assistant",
      content: "Original",
    });

    const editedResp = await handleUpdateMessage(
      jsonRequest({
        content: "Edited",
        display_content: "[Pasted text #1 +2 lines]",
      }),
      {
        id: owner.id,
        messageId: String(msg.id),
      },
    );
    assertEquals(editedResp.status, 200);
    const editedBody = await editedResp.json();
    assertEquals(editedBody.content, "Edited");
    assertEquals(editedBody.display_content, "[Pasted text #1 +2 lines]");

    const cancelledResp = await handleUpdateMessage(
      jsonRequest({ cancelled: true }),
      {
        id: owner.id,
        messageId: String(msg.id),
      },
    );
    assertEquals(cancelledResp.status, 200);
    assertEquals((await cancelledResp.json()).cancelled, 1);

    assertEquals(
      (await handleUpdateMessage(jsonRequest({}), {
        id: owner.id,
        messageId: String(msg.id),
      })).status,
      400,
    );
    assertEquals(
      (await handleUpdateMessage(jsonRequest({ content: "Hack" }), {
        id: other.id,
        messageId: String(msg.id),
      })).status,
      404,
    );
  });
});

Deno.test("handlers: delete message removes the row and updates session counts", async () => {
  await withDb(async () => {
    const owner = createSession("Count");
    const other = createSession("Other");
    const msg = insertMessage({
      session_id: owner.id,
      role: "user",
      content: "One",
    });
    insertMessage({ session_id: owner.id, role: "assistant", content: "Two" });

    const deletedResp = handleDeleteMessage(
      getRequest(`/api/chat/messages/${msg.id}`),
      { id: owner.id, messageId: String(msg.id) },
    );
    assertEquals(deletedResp.status, 200);
    assertEquals((await deletedResp.json()).deleted, true);

    assertEquals(
      (await handleGetMessage(
        getRequest(`/api/chat/messages/${msg.id}`),
        {
          id: owner.id,
          messageId: String(msg.id),
        },
      )).status,
      404,
    );
    assertEquals(
      handleDeleteMessage(
        getRequest(`/api/chat/messages/${msg.id}`),
        {
          id: other.id,
          messageId: String(msg.id),
        },
      ).status,
      404,
    );

    assertEquals(getSession(owner.id)?.message_count, 1);
  });
});

Deno.test("handlers: addMessage rejects unknown attachment ids", async () => {
  await withDb(async () => {
    const session = createSession("Messages");
    const response = await handleAddMessage(
      jsonRequest({
        role: "user",
        content: "hello",
        attachment_ids: ["att_missing"],
      }),
      { id: session.id },
    );

    assertEquals(response.status, 400);
    assertEquals(
      (await response.json()).error,
      "Attachment not found: att_missing",
    );
  });
});

Deno.test("handlers: buildEvalAttachments reconstructs pasted text and binary attachments distinctly", async () => {
  await withTempHlvmDir(async () => {
    const textRecord = await registerUploadedAttachment({
      fileName: "snippet.txt",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("alpha\nbeta"),
    });
    const imageRecord = await registerUploadedAttachment({
      fileName: "shot.png",
      mimeType: "image/png",
      bytes: Uint8Array.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
      ]),
    });

    const attachments = await buildEvalAttachments([
      textRecord.id,
      imageRecord.id,
    ]);

    assertEquals(attachments?.length, 2);
    const pastedText = attachments?.[0];
    assertExists(pastedText);
    assertEquals(pastedText?.type, "text");
    if (pastedText && "content" in pastedText) {
      assertEquals(pastedText.content, "alpha\nbeta");
      assertEquals(pastedText.displayName, "[Pasted text #1 +1 lines]");
    }

    const image = attachments?.[1];
    assertExists(image);
    assertEquals(image?.type, "image");
    if (image && !("content" in image)) {
      assertEquals(image.attachmentId, imageRecord.id);
      assertEquals(image.fileName, "shot.png");
    }
  });
});

Deno.test("handlers: buildEvalAttachments rejects missing attachment ids instead of silently dropping them", async () => {
  assertEquals(await buildEvalAttachments([]), undefined);
  let caught: Error | undefined;
  try {
    await buildEvalAttachments(["att_missing"]);
  } catch (error) {
    caught = error instanceof Error ? error : new Error(String(error));
  }
  assertExists(caught);
  assertEquals(caught?.message, "Attachment not found: att_missing");
});

Deno.test("handlers: eval chat requests reject missing attachment ids before execution", async () => {
  await withDb(async () => {
    const response = await handleChat(
      jsonRequest({
        mode: "eval",
        messages: [{
          role: "user",
          content: "(+ 1 2)",
          attachment_ids: ["att_missing"],
        }],
      }),
    );

    assertEquals(response.status, 400);
    assertEquals(
      (await response.json()).error,
      "Attachment not found: att_missing",
    );
  });
});

Deno.test("handlers: chat ignores deprecated session_id and logs a warning", async () => {
  await withDb(async () => {
    _resetActiveConversationForTesting();
    const warnings: string[] = [];
    const originalWarn = log.warn;
    (log as { warn: typeof log.warn }).warn = (
      message: string,
      ..._args: unknown[]
    ) => {
      warnings.push(message);
    };

    try {
      const activeSessionId = getActiveConversationSessionId();
      const response = await handleChat(
        jsonRequest({
          mode: "eval",
          session_id: "legacy-session-id",
          messages: [{ role: "user", content: "(+ 1 2)" }],
        }),
      );

      assertEquals(response.status, 200);
      await response.text();
      assertEquals(getActiveConversationSessionId(), activeSessionId);
      assertEquals(getSession("legacy-session-id"), null);
      assertEquals(
        warnings.some((message) =>
          message.includes("Deprecated /api/chat session_id was ignored")
        ),
        true,
      );
    } finally {
      (log as { warn: typeof log.warn }).warn = originalWarn;
      _resetActiveConversationForTesting();
    }
  });
});

Deno.test("handlers: chat rejects attachments for agent models without vision support", async () => {
  await withTempHlvmDir(async () => {
    await withDb(async () => {
      registerProvider("multimodal-test", () => ({
        name: "multimodal-test",
        displayName: "Multimodal Test",
        capabilities: [
          "chat" as const,
          "tools" as const,
          "models.list" as const,
        ],
        async *generate() {
          yield "";
        },
        async *chat() {
          yield "";
        },
        status() {
          return Promise.resolve({ available: true });
        },
        models: {
          list: () =>
            Promise.resolve([{
              name: "tools-only",
              displayName: "Tools Only",
              capabilities: ["chat", "tools"],
            }]),
          get: (name: string) =>
            Promise.resolve(
              name === "tools-only"
                ? {
                  name,
                  displayName: "Tools Only",
                  capabilities: ["chat", "tools"],
                }
                : null,
            ),
        },
      }));

      const attachment = await registerUploadedAttachment({
        fileName: "sample.png",
        mimeType: "image/png",
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      });

      const response = await handleChat(jsonRequest({
        mode: "agent",
        session_id: "session-vision-gate",
        model: "multimodal-test/tools-only",
        messages: [{
          role: "user",
          content: "describe this screenshot",
          attachment_ids: [attachment.id],
        }],
      }));

      assertEquals(response.status, 400);
      assertEquals(
        (await response.json()).error,
        "multimodal-test/tools-only does not support image attachments. Supported: PDF, audio, video, text.",
      );
    });
  });
});

Deno.test("handlers: chat surfaces provider auth failures during agent model verification", async () => {
  await withTempHlvmDir(async () => {
    await withDb(async () => {
      const originalGet = ai.models.get;
      const getCalls: Array<[string, string | undefined]> = [];
      const [fallbackProvider, fallbackModelName] = LOCAL_FALLBACK_MODEL_ID
        .split("/") as [
          string,
          string,
        ];
      (ai.models as { get: typeof ai.models.get }).get = (
        name: string,
        provider?: string,
      ) => {
        getCalls.push([name, provider]);
        if (provider === "claude-code") {
          return Promise.reject(
            new RuntimeError(
              "Claude Code OAuth token invalid or expired. Run `claude login` to re-authenticate.",
              { code: ProviderErrorCode.AUTH_FAILED },
            ),
          );
        }
        if (name === fallbackModelName && provider === fallbackProvider) {
          return Promise.resolve({
            name,
            displayName: "Local fallback",
            capabilities: ["chat", "tools"],
          });
        }
        return Promise.resolve(null);
      };

      try {
        const response = await handleChat(jsonRequest({
          mode: "agent",
          session_id: "session-auth-gate",
          model: "claude-code/claude-haiku-4-5-20251001",
          messages: [{
            role: "user",
            content: "hello world",
          }],
        }));

        assertEquals(response.status, 503);
        assertEquals(
          (await response.json()).error,
          "[PRV9004] Claude Code OAuth token invalid or expired. Run `claude login` to re-authenticate.",
        );
        assertEquals(getCalls, [[
          "claude-haiku-4-5-20251001",
          "claude-code",
        ]]);
      } finally {
        (ai.models as { get: typeof ai.models.get }).get = originalGet;
      }
    });
  });
});

Deno.test("handlers: chat resolves auto before agent capability verification", async () => {
  await withTempHlvmDir(async () => {
    await withDb(async () => {
      const originalGet = ai.models.get;
      const getCalls: Array<[string, string | undefined]> = [];
      __setListAllProviderModelsForTesting(async () => [{
        name: "gpt-4o-mini",
        displayName: "GPT-4o Mini",
        capabilities: ["chat", "tools"],
        contextWindow: 128_000,
        metadata: {
          provider: "openai",
          apiKeyConfigured: true,
        },
      }]);
      const [fallbackProvider, fallbackModelName] = LOCAL_FALLBACK_MODEL_ID
        .split("/") as [
          string,
          string,
        ];
      (ai.models as { get: typeof ai.models.get }).get = (
        name: string,
        provider?: string,
      ) => {
        getCalls.push([name, provider]);
        if (name === fallbackModelName && provider === fallbackProvider) {
          return Promise.resolve({
            name,
            displayName: "Local fallback",
            capabilities: ["chat", "tools"],
          });
        }
        return Promise.reject(
          new RuntimeError(
            "Claude Code OAuth token invalid or expired. Run `claude login` to re-authenticate.",
            { code: ProviderErrorCode.AUTH_FAILED },
          ),
        );
      };

      try {
        const response = await handleChat(jsonRequest({
          mode: "agent",
          session_id: "session-auto-auth-gate",
          model: AUTO_MODEL_ID,
          messages: [{
            role: "user",
            content: "list files in src/hlvm/agent",
          }],
        }));

        assertEquals(response.status, 503);
        assertEquals(
          (await response.json()).error,
          "[PRV9004] Claude Code OAuth token invalid or expired. Run `claude login` to re-authenticate.",
        );
        assertEquals(getCalls, [["gpt-4o-mini", "openai"]]);
      } finally {
        (ai.models as { get: typeof ai.models.get }).get = originalGet;
        __setListAllProviderModelsForTesting(null);
      }
    });
  });
});

Deno.test("handlers: agent auto rate-limit falls through to scored fallback", async () => {
  await withTempHlvmDir(async () => {
    await withDb(async () => {
      __testOnlyResetAgentReadyState();
      await config.reload();
      await config.patch({ approvedProviders: ["anthropic", "openai"] });
      const originalGet = ai.models.get;
      const llmCalls: string[] = [];
      const engine: AgentEngine = {
        createLLM: (config) => {
          const model = config.model ?? "";
          return async () => {
            llmCalls.push(model);
            if (model === "anthropic/claude-sonnet-4") {
              throw new Error("rate limit exceeded (429)");
            }
            if (model === "openai/gpt-4o-mini") {
              return {
                content: "fallback answered through auto",
                toolCalls: [],
                performance: {
                  providerName: "openai",
                  modelId: "gpt-4o-mini",
                  latencyMs: 1,
                },
              };
            }
            throw new Error(`unexpected model: ${model}`);
          };
        },
        createSummarizer: () => () => Promise.resolve(""),
      };

      __setListAllProviderModelsForTesting(async () => [
        {
          name: "claude-sonnet-4",
          displayName: "Claude Sonnet 4",
          capabilities: ["chat", "tools"],
          contextWindow: 200_000,
          metadata: {
            provider: "anthropic",
            cloud: true,
            apiKeyConfigured: true,
          },
        },
        {
          name: "gpt-4o-mini",
          displayName: "GPT-4o Mini",
          capabilities: ["chat", "tools"],
          contextWindow: 128_000,
          metadata: {
            provider: "openai",
            cloud: true,
            apiKeyConfigured: true,
          },
        },
      ]);
      (ai.models as { get: typeof ai.models.get }).get = (
        name: string,
        provider?: string,
      ) => {
        if (name === "claude-sonnet-4" && provider === "anthropic") {
          return Promise.resolve({
            name,
            displayName: "Claude Sonnet 4",
            capabilities: ["chat", "tools"],
            contextWindow: 200_000,
            metadata: {
              provider,
              cloud: true,
              apiKeyConfigured: true,
            },
          });
        }
        return Promise.resolve(null);
      };
      setAgentEngine(engine);

      try {
        const response = await handleChat(jsonRequest({
          mode: "agent",
          model: AUTO_MODEL_ID,
          stateless: true,
          trace: true,
          messages: [{
            role: "user",
            content: "answer from the auto fallback",
          }],
        }));

        assertEquals(response.status, 200);
        const events = await readNdjsonEvents(response);
        assertEquals(
          events.some((event) =>
            event.event === "token" &&
            event.text === "fallback answered through auto"
          ),
          true,
        );
        assertEquals(llmCalls, [
          "anthropic/claude-sonnet-4",
          "openai/gpt-4o-mini",
        ]);

        const autoFallbackTrace = events.find((event) => {
          if (event.event !== "trace") return false;
          const trace = event.trace as { type?: string } | undefined;
          return trace?.type === "auto_fallback";
        })?.trace as
          | { fromModel?: string; toModel?: string; reason?: string }
          | undefined;
        assertExists(autoFallbackTrace);
        assertEquals(
          autoFallbackTrace.fromModel,
          "anthropic/claude-sonnet-4",
        );
        assertEquals(autoFallbackTrace.toModel, "openai/gpt-4o-mini");
        assertEquals(autoFallbackTrace.reason, "rate_limit");

        const turnStats = events.find((event) =>
          event.event === "turn_stats"
        ) as { model_id?: string } | undefined;
        assertEquals(turnStats?.model_id, "openai/gpt-4o-mini");
      } finally {
        resetAgentEngine();
        await disposeAllSessions();
        __setListAllProviderModelsForTesting(null);
        (ai.models as { get: typeof ai.models.get }).get = originalGet;
        __testOnlyResetAgentReadyState();
      }
    });
  });
});

Deno.test("handlers: chat does not silently replace an explicit missing agent model", async () => {
  await withTempHlvmDir(async () => {
    await withDb(async () => {
      const originalGet = ai.models.get;
      const getCalls: Array<[string, string | undefined]> = [];
      const [fallbackProvider, fallbackModelName] = LOCAL_FALLBACK_MODEL_ID
        .split("/") as [
          string,
          string,
        ];
      (ai.models as { get: typeof ai.models.get }).get = (
        name: string,
        provider?: string,
      ) => {
        getCalls.push([name, provider]);
        if (name === fallbackModelName && provider === fallbackProvider) {
          return Promise.resolve({
            name,
            displayName: "Local fallback",
            capabilities: ["chat", "tools"],
          });
        }
        return Promise.resolve(null);
      };

      try {
        const response = await handleChat(jsonRequest({
          mode: "agent",
          session_id: "session-missing-explicit-model",
          model: "claude-code/claude-haiku-4-5-20990101",
          messages: [{
            role: "user",
            content: "hello world",
          }],
        }));

        assertEquals(response.status, 400);
        assertEquals(
          (await response.json()).error,
          "Model not found: claude-code/claude-haiku-4-5-20990101.",
        );
        assertEquals(getCalls, [[
          "claude-haiku-4-5-20990101",
          "claude-code",
        ]]);
      } finally {
        (ai.models as { get: typeof ai.models.get }).get = originalGet;
      }
    });
  });
});

Deno.test("handlers: chat exports track readiness by model and no-op cancellation", async () => {
  __testOnlyResetAgentReadyState();
  const modelA = "ollama/llama3.2:1b";
  const modelB = "openai/gpt-4.1-mini";

  assertEquals(typeof isAgentReady(), "boolean");
  assertEquals(isAgentReady(modelA), false);
  assertEquals(isAgentReady(modelB), false);

  markAgentReady();
  markAgentReady(modelA);

  assertEquals(isAgentReady(), true);
  assertEquals(isAgentReady(modelA), true);
  assertEquals(isAgentReady(modelB), false);
});

Deno.test("handlers: agent readiness cache evicts older model entries", () => {
  __testOnlyResetAgentReadyState();

  markAgentReady("ollama/model-0");
  assertEquals(isAgentReady("ollama/model-0"), true);

  for (let index = 1; index <= 80; index++) {
    markAgentReady(`ollama/model-${index}`);
  }

  assertEquals(isAgentReady("ollama/model-0"), false);
  assertEquals(isAgentReady("ollama/model-80"), true);
});
