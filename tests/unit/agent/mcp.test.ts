import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { getMcpConfigPath } from "../../../src/common/paths.ts";
import { getPlatform, setPlatform } from "../../../src/platform/platform.ts";
import {
  inferMcpSafetyLevel,
  loadMcpConfig,
  loadMcpTools,
} from "../../../src/hlvm/agent/mcp/mod.ts";
import { SdkMcpClient } from "../../../src/hlvm/agent/mcp/sdk-client.ts";
import {
  getTool,
  hasTool,
  prepareToolArgsForExecution,
} from "../../../src/hlvm/agent/registry.ts";
import {
  sanitizeToolName,
  validateToolSchema,
} from "../../../src/hlvm/agent/tool-schema.ts";
import {
  startOAuthServer,
  withServePermissionGuard,
} from "./oauth-test-helpers.ts";
import { withTempDir, withTempHlvmDir } from "../helpers.ts";

type FixtureServerOptions = {
  allowEnv?: string[];
  allowRead?: string[];
  allowWrite?: string[];
  env?: Record<string, string>;
  disabled_tools?: string[];
  connection_timeout_ms?: number;
};

const ONE_BY_ONE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Bt1kAAAAASUVORK5CYII=";

function fixturePath(): string {
  return getPlatform().path.join("tests", "fixtures", "mcp-server.ts");
}

function fixtureServer(name: string, options: FixtureServerOptions = {}) {
  const allowEnv = options.allowEnv?.length
    ? [`--allow-env=${options.allowEnv.join(",")}`]
    : [];
  const allowRead = options.allowRead?.length
    ? [`--allow-read=${options.allowRead.join(",")}`]
    : [];
  const allowWrite = options.allowWrite?.length
    ? [`--allow-write=${options.allowWrite.join(",")}`]
    : [];

  return {
    name,
    command: ["deno", "run", ...allowEnv, ...allowRead, ...allowWrite, fixturePath()],
    ...(options.env ? { env: options.env } : {}),
    ...(options.disabled_tools
      ? { disabled_tools: options.disabled_tools }
      : {}),
    ...(options.connection_timeout_ms
      ? { connection_timeout_ms: options.connection_timeout_ms }
      : {}),
  };
}

async function withWorkspace(
  fn: (workspace: string) => Promise<void>,
): Promise<void> {
  const platform = getPlatform();
  const workspace = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  try {
    await fn(workspace);
  } finally {
    await platform.fs.remove(workspace, { recursive: true });
  }
}

async function writeMcpConfig(servers: unknown): Promise<void> {
  const platform = getPlatform();
  const configPath = getMcpConfigPath();
  await platform.fs.mkdir(platform.path.dirname(configPath), {
    recursive: true,
  });
  await platform.fs.writeTextFile(
    configPath,
    JSON.stringify({ version: 1, servers }),
  );
}

/** Extract text from MCP-compliant tool result. */
function mcpText(result: unknown): string {
  const payload = result as { content: Array<{ type: string; text: string }> };
  return payload.content[0].text;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function withFixtureStatePath(
  fn: (statePath: string) => Promise<void>,
): Promise<void> {
  await withTempDir(async (tempDir) => {
    const statePath = getPlatform().path.join(tempDir, "mcp-state.json");
    await fn(statePath);
  });
}

Deno.test("MCP: loadMcpConfig returns null when no config exists", async () => {
  await withTempHlvmDir(async () => {
    assertEquals(await loadMcpConfig(), null);
  });
});

Deno.test({
  name:
    "MCP: loadMcpTools registers fixture tools, validates args, executes, and disposes cleanly",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      await withWorkspace(async (workspace) => {
        await writeMcpConfig([fixtureServer("test")]);

        const { tools, dispose } = await loadMcpTools(workspace);
        try {
          assertEquals(tools.includes("mcp_test_echo"), true);
          assertEquals(hasTool("mcp_test_echo"), true);
          assertEquals(
            prepareToolArgsForExecution("mcp_test_echo", {}).validation.valid,
            true,
          );

          const tool = getTool("mcp_test_echo");
          assertEquals(
            mcpText(await tool.fn({ message: "hello" }, workspace)),
            "hello",
          );
          await assertRejects(() =>
            tool.fn("bad" as unknown as Record<string, unknown>, workspace)
          );
        } finally {
          await dispose();
        }

        assertEquals(hasTool("mcp_test_echo"), false);
      });
    });
  },
});

Deno.test({
  name: "MCP: loadMcpTools skips interactive OAuth during agent registration",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withServePermissionGuard(async () => {
      await withTempHlvmDir(async () => {
        await withWorkspace(async (workspace) => {
          const oauth = await startOAuthServer({ protectMcp: true });
          const originalPlatform = getPlatform();
          let openUrlCalls = 0;
          setPlatform({
            ...originalPlatform,
            openUrl: async () => {
              openUrlCalls++;
            },
          });

          try {
            const { tools, dispose } = await loadMcpTools(workspace, [{
              name: "oauth-protected",
              url: `http://127.0.0.1:${oauth.port}/mcp`,
            }]);
            try {
              assertEquals(tools.length, 0);
              assertEquals(openUrlCalls, 0);
            } finally {
              await dispose();
            }
          } finally {
            setPlatform(originalPlatform);
            await oauth.server.shutdown();
          }
        });
      });
    });
  },
});

Deno.test({
  name:
    "MCP: owner-scoped registrations route tool calls and survive independent disposal",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      await withWorkspace(async (workspace) => {
        const first = await loadMcpTools(
          workspace,
          [fixtureServer("test", {
            allowEnv: ["MCP_REPLY_PREFIX"],
            env: { MCP_REPLY_PREFIX: "A:" },
          })],
          "owner-a",
        );
        const second = await loadMcpTools(
          workspace,
          [fixtureServer("test", {
            allowEnv: ["MCP_REPLY_PREFIX"],
            env: { MCP_REPLY_PREFIX: "B:" },
          })],
          "owner-b",
        );

        try {
          assertEquals(
            mcpText(
              await getTool("mcp_test_echo", "owner-a").fn(
                { message: "hello" },
                workspace,
              ),
            ),
            "A:hello",
          );
          assertEquals(
            mcpText(
              await getTool("mcp_test_echo", "owner-b").fn(
                { message: "hello" },
                workspace,
              ),
            ),
            "B:hello",
          );

          await first.dispose();
          assertEquals(hasTool("mcp_test_echo", "owner-a"), false);
          assertEquals(hasTool("mcp_test_echo", "owner-b"), true);
          assertEquals(
            mcpText(
              await getTool("mcp_test_echo", "owner-b").fn(
                { message: "ok" },
                workspace,
              ),
            ),
            "B:ok",
          );
        } finally {
          await first.dispose();
          await second.dispose();
        }
      });
    });
  },
});

Deno.test({
  name:
    "MCP: config servers win dedupe and broken servers do not block healthy ones",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      await withWorkspace(async (workspace) => {
        await writeMcpConfig([fixtureServer("test")]);

        const { tools, dispose } = await loadMcpTools(
          workspace,
          [
            { name: "broken", command: ["definitely-not-a-real-command"] },
            { name: "test", command: ["definitely-not-a-real-command"] },
          ],
        );

        try {
          assertEquals(tools.includes("mcp_test_echo"), true);
          assertEquals(hasTool("mcp_test_echo"), true);
        } finally {
          await dispose();
        }
      });
    });
  },
});

Deno.test("MCP: safety inference and schema normalization keep tool metadata provider-safe", () => {
  assertEquals(inferMcpSafetyLevel("render_url"), "L0");
  assertEquals(inferMcpSafetyLevel("click_button"), "L2");
  assertEquals(inferMcpSafetyLevel("custom_tool_without_hint"), "L1");

  assertEquals(
    sanitizeToolName("mcp_server.name/tool"),
    "mcp_server_name_tool",
  );
  assertEquals(sanitizeToolName("a" + "_x".repeat(80)).length, 64);
  assertEquals(/^[a-zA-Z]/.test(sanitizeToolName("123_tool")), true);

  const badTool = {
    fn: async () => {},
    description: "test",
    args: { x: "banana - weird" },
  };
  const goodTool = {
    fn: async () => {},
    description: "test",
    args: { a: "string - ok", b: "number (optional) - ok" },
  };
  assertEquals(validateToolSchema("t", badTool).length, 1);
  assertEquals(validateToolSchema("t", goodTool).length, 0);
});

Deno.test({
  name:
    "MCP: capability-gated resource and prompt tools register only when the server exposes them",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      await withWorkspace(async (workspace) => {
        const { tools, dispose } = await loadMcpTools(workspace, [
          fixtureServer("restest", {
            allowEnv: ["MCP_TEST_MODE"],
            env: { MCP_TEST_MODE: "resources" },
          }),
          fixtureServer("ptest", {
            allowEnv: ["MCP_TEST_MODE"],
            env: { MCP_TEST_MODE: "prompts" },
          }),
          fixtureServer("plain"),
        ]);

        try {
          assertEquals(tools.includes("mcp_restest_list_resources"), true);
          assertEquals(tools.includes("mcp_restest_read_resource"), true);
          assertEquals(tools.includes("mcp_ptest_list_prompts"), true);
          assertEquals(tools.includes("mcp_ptest_get_prompt"), true);
          assertEquals(tools.includes("mcp_plain_list_resources"), false);
          assertEquals(tools.includes("mcp_plain_get_prompt"), false);

          const resources = await getTool("mcp_restest_list_resources").fn(
            {},
            workspace,
          ) as {
            resources: Array<{ uri: string }>;
          };
          assertEquals(resources.resources.length, 2);

        const prompt = await getTool("mcp_ptest_get_prompt").fn(
          { name: "summarize", text: "Hello world", style: "brief" },
          workspace,
        ) as {
          messages: Array<{
            role: string;
            content: { type: "text"; text: string };
          }>;
        };
        assertEquals(prompt.messages[0]?.role, "user");
        assertEquals(
          prompt.messages[0]?.content.type === "text" &&
            prompt.messages[0].content.text.includes("Summarize: Hello world"),
          true,
        );
      } finally {
        await dispose();
      }
      });
    });
  },
});

Deno.test({
  name:
    "MCP: attachment-backed results preserve raw shapes and expose compact formatter output",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      await withWorkspace(async (workspace) => {
        const { dispose, ownerId } = await loadMcpTools(workspace, [
          fixtureServer("rich", {
            allowEnv: ["MCP_TEST_MODE"],
            env: {
              MCP_TEST_MODE:
                "resources,prompts,tool_binary,resource_blob,prompt_binary,long_description",
            },
          }),
        ]);

        try {
          const toolMeta = getTool("mcp_rich_echo", ownerId);
          const toolResult = await toolMeta.fn({ message: "hello" }, workspace) as {
            content: unknown[];
            attachments?: Array<{ attachmentId: string }>;
          };
          assertEquals(toolResult.attachments?.length, 1);
          assertEquals(toolMeta.description.length <= 2048, true);
          assertEquals(toolMeta.description.includes("\u0000"), false);
          const formattedTool = toolMeta.formatResult?.(toolResult);
          assert(formattedTool);
          assertEquals(formattedTool.llmContent?.includes(ONE_BY_ONE_PNG_BASE64), false);
          assertEquals(formattedTool.llmContent?.includes("[Image #1]"), true);

          const resourceTool = getTool("mcp_rich_read_resource", ownerId);
          const resourceResult = await resourceTool.fn(
            { uri: "file:///test/config.json" },
            workspace,
          ) as {
            contents: Array<{ blob?: string }>;
            attachments?: Array<{ attachmentId: string }>;
          };
          assertEquals(typeof resourceResult.contents[0]?.blob, "string");
          assertEquals(resourceResult.attachments?.length, 1);

          const promptTool = getTool("mcp_rich_get_prompt", ownerId);
          const promptResult = await promptTool.fn(
            { name: "summarize", text: "Hello world" },
            workspace,
          ) as {
            messages: Array<{ content: { type: string } }>;
            attachments?: Array<{ attachmentId: string }>;
          };
          assertEquals(promptResult.messages.length, 2);
          assertEquals(promptResult.messages[1]?.content.type, "image");
          assertEquals(promptResult.attachments?.length, 1);
        } finally {
          await dispose();
        }
      });
    });
  },
});

Deno.test({
  name:
    "MCP: deferred setHandlers replays queued sampling and elicitation requests",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      await withWorkspace(async (workspace) => {
        const result = await loadMcpTools(workspace, [
          fixtureServer("interactive", {
            allowEnv: ["MCP_TEST_MODE"],
            env: { MCP_TEST_MODE: "sampling,elicitation" },
          }),
        ]);

        let samplingCalled = false;
        let elicitationMessage = "";
        result.setHandlers({
          onSampling: (request) => {
            samplingCalled = Array.isArray(request.messages);
            return Promise.resolve({
              role: "assistant" as const,
              content: { type: "text" as const, text: "The answer is 4" },
              model: "test-model",
            });
          },
          onElicitation: (request) => {
            elicitationMessage = request.message;
            return Promise.resolve({
              action: "accept" as const,
              content: { confirmed: true },
            });
          },
        });

        try {
          await waitFor(() => samplingCalled && elicitationMessage.length > 0);
          assertEquals(samplingCalled, true);
          assertEquals(elicitationMessage, "Please confirm deployment");
        } finally {
          await result.dispose();
        }
      });
    });
  },
});

Deno.test({
  name: "MCP: setSignal aborts in-flight tool calls promptly",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      await withWorkspace(async (workspace) => {
        const { dispose, ownerId, setSignal } = await loadMcpTools(workspace, [
          fixtureServer("abortable", {
            allowEnv: ["MCP_TOOL_DELAY_MS"],
            env: { MCP_TOOL_DELAY_MS: "5000" },
          }),
        ]);

        const controller = new AbortController();
        setSignal(controller.signal);

        const tool = getTool("mcp_abortable_echo", ownerId);
        const startedAt = Date.now();
        const abortTimer = setTimeout(() => controller.abort(), 50);
        try {
          const error = await assertRejects(
            () => tool.fn({ message: "hello" }, workspace),
            Error,
          );
          const elapsed = Date.now() - startedAt;
          const aborted = error.name === "AbortError" ||
            error.message.toLowerCase().includes("abort");
          assertEquals(aborted, true);
          assertEquals(elapsed < 1500, true);
        } finally {
          clearTimeout(abortTimer);
          await dispose();
        }
      });
    });
  },
});

Deno.test({
  name:
    "MCP: disabled_tools excludes configured server tools from registration",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      await withWorkspace(async (workspace) => {
        const { tools, dispose } = await loadMcpTools(workspace, [
          fixtureServer("filtered", { disabled_tools: ["echo"] }),
        ]);

        try {
          assertEquals(tools.includes("mcp_filtered_echo"), false);
          assertEquals(hasTool("mcp_filtered_echo"), false);
        } finally {
          await dispose();
        }
      });
    });
  },
});

Deno.test({
  name: "MCP: stdio disconnect_once triggers a real reconnect and retries listTools",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withFixtureStatePath(async (statePath) => {
      const stateDir = getPlatform().path.dirname(statePath);
      const client = new SdkMcpClient(
        fixtureServer("reconnect", {
          allowEnv: ["MCP_TEST_MODE", "MCP_STATE_PATH"],
          allowRead: [stateDir],
          allowWrite: [stateDir],
          env: {
            MCP_TEST_MODE: "disconnect_once",
            MCP_STATE_PATH: statePath,
          },
        }),
      );
      const reconnectEvents: number[] = [];
      client.onReconnect(() => reconnectEvents.push(Date.now()));

      try {
        await client.start();
        const tools = await client.listTools();
        assertEquals(tools.map((tool) => tool.name), ["echo"]);
        assertEquals(reconnectEvents.length, 1);
      } finally {
        await client.close();
      }
    });
  },
});

Deno.test({
  name:
    "MCP: reconnect refresh updates registered tools after server restart",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      await withWorkspace(async (workspace) => {
        await withFixtureStatePath(async (statePath) => {
          const stateDir = getPlatform().path.dirname(statePath);
          const { tools, dispose, ownerId } = await loadMcpTools(workspace, [
            fixtureServer("dynamic", {
              allowEnv: ["MCP_TEST_MODE", "MCP_STATE_PATH"],
              allowRead: [stateDir],
              allowWrite: [stateDir],
              env: {
                MCP_TEST_MODE: "disconnect_once,dynamic_tools",
                MCP_STATE_PATH: statePath,
              },
            }),
          ]);

          try {
            assertEquals(tools.includes("mcp_dynamic_echo"), true);
            assertEquals(tools.includes("mcp_dynamic_stable_echo"), true);
            assertEquals(tools.includes("mcp_dynamic_reverse"), false);

            const stable = getTool("mcp_dynamic_stable_echo", ownerId);
            assertEquals(
              mcpText(await stable.fn({ message: "hello" }, workspace)),
              "gen2:hello",
            );

            await waitFor(() =>
              hasTool("mcp_dynamic_reverse", ownerId) &&
              !hasTool("mcp_dynamic_echo", ownerId)
            );

            assertEquals(hasTool("mcp_dynamic_stable_echo", ownerId), true);
            const reverse = getTool("mcp_dynamic_reverse", ownerId);
            assertEquals(
              mcpText(await reverse.fn({ text: "stressed" }, workspace)),
              "desserts",
            );
          } finally {
            await dispose();
          }

          assertEquals(hasTool("mcp_dynamic_reverse", ownerId), false);
          assertEquals(hasTool("mcp_dynamic_stable_echo", ownerId), false);
        });
      });
    });
  },
});
