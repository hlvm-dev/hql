import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  getToolResultSidecarPath,
  getToolResultsSessionDir,
  resetHlvmDirCacheForTests,
  setHlvmDirForTests,
} from "../../../src/common/paths.ts";
import type { OrchestratorConfig } from "../../../src/hlvm/agent/orchestrator.ts";
import {
  buildToolObservation,
  buildToolResultOutputs,
} from "../../../src/hlvm/agent/orchestrator-tool-formatting.ts";
import {
  formatToolError,
  normalizeToolFailureText,
} from "../../../src/hlvm/agent/tool-results.ts";
import {
  _resetToolResultStorageForTests,
  persistToolResultSidecar,
} from "../../../src/hlvm/agent/tool-result-storage.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

Deno.test("tool-results: normalizeToolFailureText merges stderr/stdout once", () => {
  const normalized = normalizeToolFailureText({
    message: "Command failed",
    stderr: "permission denied",
    stdout: "partial output",
  });

  assertStringIncludes(normalized, "Command failed");
  assertStringIncludes(normalized, "stderr:\npermission denied");
  assertStringIncludes(normalized, "stdout:\npartial output");
});

Deno.test("tool-results: formatToolError classifies timeout failures", () => {
  const formatted = formatToolError(
    "Click failed",
    new Error("Timeout 10000ms exceeded"),
  );

  assertStringIncludes(
    formatted.message,
    "Click failed: Timeout 10000ms exceeded",
  );
  assertEquals(formatted.failure.kind, "timeout");
  assertEquals(formatted.failure.retryable, true);
});

Deno.test("tool-results: buildToolResultOutputs marks silent text success explicitly", async () => {
  const config = {
    context: { truncateResult: (value: string) => value },
  } as unknown as OrchestratorConfig;

  const outputs = await buildToolResultOutputs(
    "empty_tool",
    { success: true },
    config,
  );

  assertStringIncludes(
    outputs.llmContent,
    "empty_tool completed with no output",
  );
  assertStringIncludes(
    outputs.returnDisplay,
    "empty_tool completed with no output",
  );
});

Deno.test("tool-results: buildToolResultOutputs persists oversized tool output to a session sidecar", async () => {
  const hlvmDir = await Deno.makeTempDir({ prefix: "hlvm-tool-results-" });
  setHlvmDirForTests(hlvmDir);
  _resetToolResultStorageForTests();

  try {
    const config = {
      context: { truncateResult: (value: string) => value },
      sessionId: "session-123",
    } as unknown as OrchestratorConfig;

    const stdout = Array.from(
      { length: 500 },
      (_, index) => `line ${index + 1} ${"x".repeat(40)}`,
    ).join("\n");

    const outputs = await buildToolResultOutputs(
      "shell_exec",
      { exitCode: 0, stdout, stderr: "" },
      config,
      "tool-call-456",
    );

    const sidecarPath = getToolResultSidecarPath(
      "session-123",
      "tool-call-456",
      "txt",
    );
    const persisted = await getPlatform().fs.readTextFile(sidecarPath);

    assertStringIncludes(
      outputs.llmContent,
      "Full tool result was persisted to",
    );
    assertStringIncludes(outputs.llmContent, sidecarPath);
    assertStringIncludes(outputs.llmContent, "Preview:");
    assertStringIncludes(persisted, "stdout:");
    assertStringIncludes(persisted, "line 1");
    assertStringIncludes(persisted, "line 500");
  } finally {
    _resetToolResultStorageForTests();
    resetHlvmDirCacheForTests();
    await getPlatform().fs.remove(hlvmDir, { recursive: true });
  }
});

Deno.test("tool-results: persistToolResultSidecar prunes stale sessions and keeps the active session", async () => {
  const hlvmDir = await Deno.makeTempDir({
    prefix: "hlvm-tool-results-stale-",
  });
  setHlvmDirForTests(hlvmDir);
  _resetToolResultStorageForTests();

  try {
    const platform = getPlatform();
    const staleDir = getToolResultsSessionDir("stale-session");
    await platform.fs.mkdir(staleDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(staleDir, "old.txt"),
      "stale",
    );
    const staleTime = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await Deno.utime(staleDir, staleTime, staleTime);

    await persistToolResultSidecar({
      sessionId: "active-session",
      toolCallId: "tool-call-1",
      content: "fresh",
      format: "txt",
    });

    assertEquals(await platform.fs.exists(staleDir), false);
    assertEquals(
      await platform.fs.exists(getToolResultsSessionDir("active-session")),
      true,
    );
  } finally {
    _resetToolResultStorageForTests();
    resetHlvmDirCacheForTests();
    await getPlatform().fs.remove(hlvmDir, { recursive: true });
  }
});

Deno.test("tool-results: buildToolObservation renders failure facts before raw error text and preserves hints", async () => {
  const built = await buildToolObservation(
    { id: "call-1", toolName: "pw_click", args: { selector: "#submit" } },
    {
      success: false,
      error: "Timeout 10000ms exceeded while clicking selector",
      failure: {
        source: "tool",
        kind: "timeout",
        retryable: true,
        facts: {
          selector: "#submit",
          step: "login",
        },
      },
      diagnosticText:
        'Accessibility snapshot:\n- button "Submit"\n- text "Sign in"',
    },
  );

  const { observation } = built;
  const kindIndex = observation.indexOf("Error kind: timeout");
  const factsIndex = observation.indexOf("Key facts:");
  const errorIndex = observation.indexOf(
    "Error: Timeout 10000ms exceeded while clicking selector",
  );

  assertEquals(kindIndex >= 0, true);
  assertEquals(factsIndex > kindIndex, true);
  assertEquals(errorIndex > factsIndex, true);
  assertStringIncludes(observation, "selector=#submit");
  assertStringIncludes(observation, "step=login");
  assertStringIncludes(
    observation,
    "Hint: Operation timed out. Try a simpler query or break the task into smaller steps.",
  );
  assertStringIncludes(observation, "Diagnostics:\nAccessibility snapshot:");
});
