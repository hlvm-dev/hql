import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "jsr:@std/assert";
import type { ToolCall } from "../../../src/hlvm/agent/tool-call.ts";
import {
  createLspDiagnosticsRuntime,
  type LspServerCandidate,
} from "../../../src/hlvm/agent/lsp-diagnostics.ts";
import { maybeVerifyWrite } from "../../../src/hlvm/agent/orchestrator-tool-execution.ts";
import type { OrchestratorConfig } from "../../../src/hlvm/agent/orchestrator.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

const platform = getPlatform();
const FIXTURE_SERVER_PATH = platform.path.fromFileUrl(
  new URL("../../fixtures/lsp-diagnostics-server.ts", import.meta.url),
);

function createFixtureCandidate(languageId = "typescript"): LspServerCandidate {
  return {
    key: `fixture:${languageId}`,
    label: "fixture-lsp",
    command: [Deno.execPath(), "run", "-A", FIXTURE_SERVER_PATH],
    languageId,
  };
}

function createWriteToolCall(path: string): ToolCall {
  return {
    id: "tool-1",
    toolName: "write_file",
    args: { path },
  };
}

Deno.test("maybeVerifyWrite uses LSP diagnostics when available and tracks follow-up edits", async () => {
  const workspace = await platform.fs.makeTempDir({ prefix: "hlvm-lsp-" });
  const filePath = platform.path.join(workspace, "demo.ts");
  const runtime = createLspDiagnosticsRuntime({
    workspace,
    resolveCandidates: async () => [createFixtureCandidate()],
  });
  const config = {
    workspace,
    lspDiagnostics: runtime,
  } as OrchestratorConfig;

  try {
    const toolCall = createWriteToolCall(filePath);

    await platform.fs.writeTextFile(filePath, "missingName();\n");
    const first = await maybeVerifyWrite(toolCall, config);
    assertExists(first);
    assertEquals(first.source, "lsp");
    assertEquals(first.verifier, "fixture-lsp");
    assertEquals(first.ok, false);
    assertStringIncludes(first.summary, "1 error");
    assertStringIncludes(
      first.diagnostics ?? "",
      "Cannot find name 'missingName'.",
    );

    await platform.fs.writeTextFile(filePath, "const ok = 1;\n");
    const second = await maybeVerifyWrite(toolCall, config);
    assertExists(second);
    assertEquals(second.source, "lsp");
    assertEquals(second.ok, true);
    assertStringIncludes(second.summary, "passed");
  } finally {
    await runtime.dispose();
    await platform.fs.remove(workspace, { recursive: true });
  }
});

Deno.test("maybeVerifyWrite falls back to syntax checks when no LSP server is available", async () => {
  const workspace = await platform.fs.makeTempDir({
    prefix: "hlvm-lsp-fallback-",
  });
  const filePath = platform.path.join(workspace, "broken.ts");
  const runtime = createLspDiagnosticsRuntime({
    workspace,
    resolveCandidates: async () => [],
  });
  const config = {
    workspace,
    lspDiagnostics: runtime,
  } as OrchestratorConfig;

  try {
    await platform.fs.writeTextFile(
      platform.path.join(workspace, "deno.json"),
      "{}\n",
    );
    await platform.fs.writeTextFile(filePath, "const x = ;\n");

    const result = await maybeVerifyWrite(
      createWriteToolCall(filePath),
      config,
    );
    assertExists(result);
    assertEquals(result.source, "syntax");
    assertEquals(result.ok, false);
    assertStringIncludes(result.verifier, "deno check");
    assertStringIncludes(result.summary, "Syntax check failed via deno check.");
    assertStringIncludes(result.diagnostics ?? "", "error");
  } finally {
    await runtime.dispose();
    await platform.fs.remove(workspace, { recursive: true });
  }
});

Deno.test("maybeVerifyWrite waits for settled diagnostics when LSP publishes empty results first", async () => {
  const workspace = await platform.fs.makeTempDir({
    prefix: "hlvm-lsp-delayed-",
  });
  const filePath = platform.path.join(workspace, "delayed.ts");
  const runtime = createLspDiagnosticsRuntime({
    workspace,
    resolveCandidates: async () => [createFixtureCandidate()],
  });
  const config = {
    workspace,
    lspDiagnostics: runtime,
  } as OrchestratorConfig;

  try {
    await platform.fs.writeTextFile(filePath, "delayedMissingName();\n");

    const result = await maybeVerifyWrite(
      createWriteToolCall(filePath),
      config,
    );
    assertExists(result);
    assertEquals(result.source, "lsp");
    assertEquals(result.ok, false);
    assertStringIncludes(result.summary, "1 error");
    assertStringIncludes(
      result.diagnostics ?? "",
      "Cannot find name 'delayedMissingName'.",
    );
  } finally {
    await runtime.dispose();
    await platform.fs.remove(workspace, { recursive: true });
  }
});

Deno.test("maybeVerifyWrite retries a fresh LSP session after the server crashes mid-verify", async () => {
  const workspace = await platform.fs.makeTempDir({
    prefix: "hlvm-lsp-retry-",
  });
  const filePath = platform.path.join(workspace, "retry.ts");
  const runtime = createLspDiagnosticsRuntime({
    workspace,
    resolveCandidates: async () => [createFixtureCandidate()],
  });
  const config = {
    workspace,
    lspDiagnostics: runtime,
  } as OrchestratorConfig;

  try {
    await platform.fs.writeTextFile(filePath, "restartOnce missingName();\n");

    const result = await maybeVerifyWrite(
      createWriteToolCall(filePath),
      config,
    );
    assertExists(result);
    assertEquals(result.source, "lsp");
    assertEquals(result.ok, false);
    assertStringIncludes(result.summary, "1 error");
    assertStringIncludes(
      result.diagnostics ?? "",
      "Cannot find name 'missingName'.",
    );
  } finally {
    await runtime.dispose();
    await platform.fs.remove(workspace, { recursive: true });
  }
});
