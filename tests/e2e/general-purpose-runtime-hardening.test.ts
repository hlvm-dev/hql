/**
 * Opt-in Phase 1 hardening evaluation.
 *
 * Purpose:
 * - Prove deferred tool discovery works from the real main-thread eager surface
 * - Exercise actual permission prompts instead of bypassing them
 * - Validate memory-enabled behavior across turns
 * - Catch cases where happy-path tool-selection tests were too shallow
 *
 * Run:
 *   HLVM_E2E_GENERAL_PURPOSE_RUNTIME=1 \
 *   HLVM_LIVE_AGENT_MODEL=ollama/gemma4:e4b \
 *   deno test --no-check --allow-all tests/e2e/general-purpose-runtime-hardening.test.ts
 */

import { assertEquals } from "jsr:@std/assert";
import type {
  InteractionRequestEvent,
  InteractionResponse,
} from "../../src/hlvm/agent/registry.ts";
import type { AgentSession } from "../../src/hlvm/agent/session.ts";
import { REPL_MAIN_THREAD_QUERY_SOURCE } from "../../src/hlvm/agent/query-tool-routing.ts";
import type {
  AgentUIEvent,
  TraceEvent,
} from "../../src/hlvm/agent/orchestrator.ts";
import { setFileToolRuntimeForTest } from "../../src/hlvm/agent/tools/file-tools.ts";
import { getPlatform } from "../../src/platform/platform.ts";
import { fixtureServer, writeMcpConfig } from "./mcp-fixture-helpers.ts";
import {
  runSourceAgentWithCompatibleModel,
  withFullyIsolatedEnv,
} from "./native-provider-smoke-helpers.ts";

const platform = getPlatform();
const ENABLED = platform.env.get("HLVM_E2E_GENERAL_PURPOSE_RUNTIME") === "1";
const TIMEOUT_MS = 600_000;

const DEFAULT_MODEL_CANDIDATES = [
  "claude-code/claude-haiku-4-5-20251001",
  "claude-code/claude-haiku-4-5-20251001:agent",
  "claude-haiku-4.5",
  "claude-haiku-4-5-20251001",
  "claude-haiku-4-5-20251001:agent",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.0-flash-001",
] as const;
const liveModel = platform.env.get("HLVM_LIVE_AGENT_MODEL")?.trim() ?? "";
const MODEL_CANDIDATES = [
  ...new Set(
    [liveModel, ...DEFAULT_MODEL_CANDIDATES].filter((value) =>
      value.length > 0
    ),
  ),
];

interface ScenarioResult {
  model: string;
  text: string;
  toolNames: string[];
  toolCalls: Array<{ name: string; args: unknown }>;
  interactions: InteractionRequestEvent[];
  liveSession?: AgentSession;
}

function renderWorkspaceScopedQuery(
  query: string,
  workspace: string,
  extra: string[] = [],
): string {
  return [
    query,
    "",
    `Current workspace: ${workspace}`,
    "Use the current workspace for local files mentioned in this request.",
    "If a dedicated tool is not already visible, use tool_search to discover it instead of falling back to shell_exec.",
    ...extra,
  ].join("\n");
}

function collectToolNames(events: AgentUIEvent[]): string[] {
  return events
    .filter((event): event is Extract<AgentUIEvent, { type: "tool_end" }> =>
      event.type === "tool_end"
    )
    .map((event) => event.name);
}

function collectToolCalls(
  traces: TraceEvent[],
): Array<{ name: string; args: unknown }> {
  return traces
    .filter((event): event is Extract<TraceEvent, { type: "tool_call" }> =>
      event.type === "tool_call"
    )
    .map((event) => ({ name: event.toolName, args: event.args }));
}

function expectContains(
  haystack: string,
  needle: string,
  label: string,
): string[] {
  return haystack.toLowerCase().includes(needle.toLowerCase())
    ? []
    : [`Expected ${label} to contain '${needle}' but it did not.`];
}

function expectTool(
  toolNames: string[],
  name: string,
  context: string,
): string[] {
  return toolNames.includes(name) ? [] : [
    `Expected ${context} to use '${name}', got: ${
      toolNames.join(", ") || "(none)"
    }`,
  ];
}

function expectNoTool(
  toolNames: string[],
  name: string,
  context: string,
): string[] {
  return toolNames.includes(name)
    ? [`Expected ${context} not to use '${name}', got: ${toolNames.join(", ")}`]
    : [];
}

function filterPermissionInteractions(
  interactions: InteractionRequestEvent[],
  toolName: string,
): InteractionRequestEvent[] {
  return interactions.filter((event) =>
    event.mode === "permission" && event.toolName === toolName
  );
}

async function writeWorkspaceFiles(
  workspace: string,
  fixtures: Record<string, string>,
): Promise<void> {
  for (const [name, content] of Object.entries(fixtures)) {
    const filePath = platform.path.join(workspace, name);
    await platform.fs.mkdir(platform.path.dirname(filePath), {
      recursive: true,
    });
    await platform.fs.writeTextFile(filePath, content);
  }
}

async function withHttpFixtureServer(
  routes: Record<string, string>,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const serveWithHandle = platform.http.serveWithHandle;
  if (!serveWithHandle) {
    throw new Error(
      "platform.http.serveWithHandle is required for web discovery evals.",
    );
  }
  const port = await platform.http.findFreePort();
  const handle = serveWithHandle((req) => {
    const path = new URL(req.url).pathname;
    const body = routes[path];
    if (body === undefined) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(body, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }, {
    hostname: "127.0.0.1",
    port,
    onListen: () => {},
  });

  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
}

async function runScenario(options: {
  query: string;
  workspace: string;
  permissionMode?: "default" | "bypassPermissions";
  disablePersistentMemory?: boolean;
  reusableSession?: AgentSession;
  retainSessionForReuse?: boolean;
  onInteraction?: (
    event: InteractionRequestEvent,
  ) => Promise<InteractionResponse>;
  extraPrompt?: string[];
}): Promise<ScenarioResult> {
  const events: AgentUIEvent[] = [];
  const traces: TraceEvent[] = [];
  const interactions: InteractionRequestEvent[] = [];
  const { model, result } = await runSourceAgentWithCompatibleModel({
    models: MODEL_CANDIDATES,
    query: renderWorkspaceScopedQuery(
      options.query,
      options.workspace,
      options.extraPrompt,
    ),
    workspace: options.workspace,
    querySource: REPL_MAIN_THREAD_QUERY_SOURCE,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    permissionMode: options.permissionMode,
    disablePersistentMemory: options.disablePersistentMemory,
    reusableSession: options.reusableSession,
    retainSessionForReuse: options.retainSessionForReuse,
    maxTokens: 2_000,
    callbacks: {
      onAgentEvent: (event) => events.push(event),
      onTrace: (event) => traces.push(event),
      onInteraction: options.onInteraction
        ? async (event) => {
          interactions.push(event);
          return await options.onInteraction!(event);
        }
        : undefined,
    },
  });

  return {
    model,
    text: result.text.trim(),
    toolNames: collectToolNames(events),
    toolCalls: collectToolCalls(traces),
    interactions,
    liveSession: result.liveSession,
  };
}

Deno.test({
  name:
    "E2E eval: Phase 1 hardening covers lazy discovery, permission flow, and memory-on behavior",
  ignore: !ENABLED,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const failures: string[] = [];
    let retainedSession: AgentSession | undefined;

    try {
      await withFullyIsolatedEnv(async (workspace) => {
        await writeMcpConfig([
          fixtureServer("productivity", {
            allowEnv: ["MCP_TEST_MODE"],
            env: { MCP_TEST_MODE: "productivity_tools" },
          }),
        ]);

        await writeWorkspaceFiles(workspace, {
          "followup.txt":
            "- Ship the beta build by Friday.\n- Send the updated onboarding doc.\n",
          "trash-one.tmp": "tmp one",
          "trash-two.tmp": "tmp two",
        });

        // Scenario 1: deferred web discovery from the real main-thread eager surface.
        try {
          await withHttpFixtureServer({
            "/guide":
              "Receipt workflow:\n1. Rename the PDFs by date.\n2. Archive the folder into receipts-2026.zip.\n",
          }, async (baseUrl) => {
            const result = await runScenario({
              query:
                `Read ${baseUrl}/guide and summarize the workflow in one sentence.`,
              workspace,
              permissionMode: "bypassPermissions",
              disablePersistentMemory: true,
            });
            const usedDeferredWebTool =
              result.toolNames.includes("fetch_url") ||
              result.toolNames.includes("web_fetch");
            const errors = [
              ...expectTool(
                result.toolNames,
                "tool_search",
                "lazy web discovery",
              ),
              ...(usedDeferredWebTool ? [] : [
                `Expected lazy web discovery to use fetch_url or web_fetch, got: ${
                  result.toolNames.join(", ") || "(none)"
                }`,
              ]),
              ...expectNoTool(
                result.toolNames,
                "shell_exec",
                "lazy web discovery",
              ),
              ...expectContains(result.text, "archiv", "web summary"),
            ];
            if (errors.length > 0) {
              failures.push([
                "Scenario: lazy_web_discovery",
                `Model: ${result.model}`,
                `Tools: ${result.toolNames.join(", ") || "(none)"}`,
                `Response: ${result.text.slice(0, 240)}`,
                ...errors.map((error) => `FAIL: ${error}`),
              ].join("\n"));
            }
          });
        } catch (error) {
          failures.push(
            `Scenario: lazy_web_discovery — ERROR: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }

        // Scenario 2: lazy MCP discovery from the real main-thread eager surface.
        try {
          const result = await runScenario({
            query:
              "Read followup.txt and create a draft email to alex@example.com with subject 'Lazy discovery check'. Do not send anything.",
            workspace,
            permissionMode: "bypassPermissions",
            disablePersistentMemory: true,
            extraPrompt: [
              "This is a test-only environment. Use the available productivity MCP tool for drafts instead of shell_exec.",
            ],
          });
          const errors = [
            ...expectTool(
              result.toolNames,
              "tool_search",
              "lazy MCP discovery",
            ),
            ...expectTool(
              result.toolNames,
              "mcp_productivity_gmail_create_draft",
              "lazy MCP discovery",
            ),
            ...expectNoTool(
              result.toolNames,
              "shell_exec",
              "lazy MCP discovery",
            ),
            ...expectContains(result.text, "draft", "response"),
          ];
          if (errors.length > 0) {
            failures.push([
              "Scenario: lazy_mcp_discovery",
              `Model: ${result.model}`,
              `Tools: ${result.toolNames.join(", ") || "(none)"}`,
              `Response: ${result.text.slice(0, 240)}`,
              ...errors.map((error) => `FAIL: ${error}`),
            ].join("\n"));
          }
        } catch (error) {
          failures.push(
            `Scenario: lazy_mcp_discovery — ERROR: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }

        // Scenario 3: deferred destructive tool with real approval prompt.
        let emptied = 0;
        setFileToolRuntimeForTest({
          emptyTrash: async () => {
            emptied += 1;
          },
        });
        try {
          const approved = await runScenario({
            query: "Empty the Trash now.",
            workspace,
            permissionMode: "default",
            disablePersistentMemory: true,
            onInteraction: async () => ({
              approved: true,
            }),
          });
          const permissionInteractions = filterPermissionInteractions(
            approved.interactions,
            "empty_trash",
          );
          const errors = [
            ...expectTool(
              approved.toolNames,
              "tool_search",
              "approved empty_trash flow",
            ),
            ...expectTool(
              approved.toolNames,
              "empty_trash",
              "approved empty_trash flow",
            ),
            ...(permissionInteractions.length === 1 ? [] : [
              `Expected exactly 1 permission interaction for empty_trash, got ${permissionInteractions.length}.`,
            ]),
            ...(permissionInteractions[0]?.toolName === "empty_trash" ? [] : [
              `Expected permission request for empty_trash, got ${
                permissionInteractions[0]?.toolName ?? "(none)"
              }.`,
            ]),
            ...(emptied === 1 ? [] : [
              `Expected test emptyTrash runtime to run once, got ${emptied}.`,
            ]),
          ];
          if (errors.length > 0) {
            failures.push([
              "Scenario: empty_trash_approved",
              `Model: ${approved.model}`,
              `Tools: ${approved.toolNames.join(", ") || "(none)"}`,
              `Interactions: ${approved.interactions.length}`,
              `Response: ${approved.text.slice(0, 240)}`,
              ...errors.map((error) => `FAIL: ${error}`),
            ].join("\n"));
          }
        } catch (error) {
          failures.push(
            `Scenario: empty_trash_approved — ERROR: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        } finally {
          setFileToolRuntimeForTest(null);
        }

        // Scenario 4: deferred destructive tool denial should not execute.
        emptied = 0;
        setFileToolRuntimeForTest({
          emptyTrash: async () => {
            emptied += 1;
          },
        });
        try {
          const denied = await runScenario({
            query: "Empty the Trash now.",
            workspace,
            permissionMode: "default",
            disablePersistentMemory: true,
            onInteraction: async () => ({
              approved: false,
            }),
          });
          const permissionInteractions = filterPermissionInteractions(
            denied.interactions,
            "empty_trash",
          );
          const errors = [
            ...(permissionInteractions.length === 1 ? [] : [
              `Expected exactly 1 permission interaction for denied empty_trash, got ${permissionInteractions.length}.`,
            ]),
            ...(emptied === 0 ? [] : [
              `Expected test emptyTrash runtime not to run, got ${emptied}.`,
            ]),
          ];
          if (errors.length > 0) {
            failures.push([
              "Scenario: empty_trash_denied",
              `Model: ${denied.model}`,
              `Tools: ${denied.toolNames.join(", ") || "(none)"}`,
              `Interactions: ${denied.interactions.length}`,
              `Response: ${denied.text.slice(0, 240)}`,
              ...errors.map((error) => `FAIL: ${error}`),
            ].join("\n"));
          }
        } catch (error) {
          failures.push(
            `Scenario: empty_trash_denied — ERROR: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        } finally {
          setFileToolRuntimeForTest(null);
        }

        // Scenario 5: L1 permission cache should prompt once and reuse approval.
        try {
          const firstInteractions: InteractionRequestEvent[] = [];
          const first = await runScenario({
            query: "Move trash-one.tmp to the Trash.",
            workspace,
            permissionMode: "default",
            disablePersistentMemory: true,
            retainSessionForReuse: true,
            onInteraction: async (event) => {
              firstInteractions.push(event);
              return {
                approved: true,
                rememberChoice: true,
              };
            },
          });
          retainedSession = first.liveSession;
          if (!retainedSession) {
            failures.push(
              "Scenario: l1_permission_cache — first run did not return a reusable liveSession.",
            );
          } else {
            const secondInteractions: InteractionRequestEvent[] = [];
            const second = await runScenario({
              query: "Move trash-two.tmp to the Trash.",
              workspace,
              permissionMode: "default",
              disablePersistentMemory: true,
              reusableSession: retainedSession,
              onInteraction: async (event) => {
                secondInteractions.push(event);
                return {
                  approved: true,
                  rememberChoice: true,
                };
              },
            });
            const firstPermissionInteractions = filterPermissionInteractions(
              firstInteractions,
              "move_to_trash",
            );
            const secondPermissionInteractions = filterPermissionInteractions(
              secondInteractions,
              "move_to_trash",
            );
            const errors = [
              ...expectTool(
                first.toolNames,
                "move_to_trash",
                "first L1 cache run",
              ),
              ...expectTool(
                second.toolNames,
                "move_to_trash",
                "second L1 cache run",
              ),
              ...(firstPermissionInteractions.length === 1 ? [] : [
                `Expected exactly 1 permission interaction on first L1 run, got ${firstPermissionInteractions.length}.`,
              ]),
              ...(secondPermissionInteractions.length === 0 ? [] : [
                `Expected 0 permission interactions on second L1 run, got ${secondPermissionInteractions.length}.`,
              ]),
              ...(await platform.fs.exists(
                  platform.path.join(workspace, "trash-one.tmp"),
                )
                ? ["Expected trash-one.tmp to be gone after first L1 run."]
                : []),
              ...(await platform.fs.exists(
                  platform.path.join(workspace, "trash-two.tmp"),
                )
                ? ["Expected trash-two.tmp to be gone after second L1 run."]
                : []),
            ];
            if (errors.length > 0) {
              failures.push([
                "Scenario: l1_permission_cache",
                `First tools: ${first.toolNames.join(", ") || "(none)"}`,
                `Second tools: ${second.toolNames.join(", ") || "(none)"}`,
                `First response: ${first.text.slice(0, 180)}`,
                `Second response: ${second.text.slice(0, 180)}`,
                ...errors.map((error) => `FAIL: ${error}`),
              ].join("\n"));
            }
          }
        } catch (error) {
          failures.push(
            `Scenario: l1_permission_cache — ERROR: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        } finally {
          await retainedSession?.dispose().catch(() => {});
          retainedSession = undefined;
        }

        // Scenario 6: memory-enabled recall. Persistence may happen through
        // deterministic extraction rather than an explicit memory_write call.
        try {
          const remember = await runScenario({
            query:
              "Remember this preference for future work: I keep receipts in ~/Documents/Receipts. Save it to memory.",
            workspace,
            permissionMode: "bypassPermissions",
            disablePersistentMemory: false,
          });
          const recall = await runScenario({
            query: "Where do I keep receipts?",
            workspace,
            permissionMode: "bypassPermissions",
            disablePersistentMemory: false,
          });
          const errors = [
            ...expectContains(
              recall.text,
              "~/Documents/Receipts",
              "memory recall response",
            ),
            ...expectNoTool(
              remember.toolNames,
              "shell_exec",
              "memory remember flow",
            ),
            ...expectNoTool(
              recall.toolNames,
              "shell_exec",
              "memory recall flow",
            ),
          ];
          if (errors.length > 0) {
            failures.push([
              "Scenario: persistent_memory_round_trip",
              `Remember model: ${remember.model}`,
              `Recall model: ${recall.model}`,
              `Remember tools: ${remember.toolNames.join(", ") || "(none)"}`,
              `Recall tools: ${recall.toolNames.join(", ") || "(none)"}`,
              `Recall response: ${recall.text.slice(0, 240)}`,
              ...errors.map((error) => `FAIL: ${error}`),
            ].join("\n"));
          }
        } catch (error) {
          failures.push(
            `Scenario: persistent_memory_round_trip — ERROR: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      });
    } finally {
      setFileToolRuntimeForTest(null);
      await retainedSession?.dispose().catch(() => {});
    }

    assertEquals(
      failures,
      [],
      `Phase 1 hardening eval failures:\n${failures.join("\n\n")}`,
    );
  },
});
