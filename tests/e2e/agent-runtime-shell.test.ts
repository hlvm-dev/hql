import {
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import { getPlatform } from "../../src/platform/platform.ts";
import { findFreePort } from "../shared/light-helpers.ts";
import { shutdownRuntimeHostIfPresent } from "../shared/runtime-host-test-helpers.ts";

const platform = getPlatform();
const FIXTURE_PATH = platform.path.fromFileUrl(
  new URL("../fixtures/ask/agent-transcript-fixture.json", import.meta.url),
);
const HLVM_BINARY_PATH = platform.path.fromFileUrl(
  new URL("../../hlvm", import.meta.url),
);
const LIVE_MODEL = platform.env.get("HLVM_LIVE_AGENT_MODEL")?.trim() || "";

function normalizeCliOutput(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n");
}

async function runLocalAsk(
  port: number,
  args: string[],
  env: Record<string, string>,
): Promise<{ success: boolean; stdout: string; stderr: string; code: number }> {
  const output = await platform.command.output({
    cmd: [HLVM_BINARY_PATH, "ask", ...args],
    env: {
      ...platform.env.toObject(),
      HLVM_REPL_PORT: String(port),
      ...env,
    },
    stdout: "piped",
    stderr: "piped",
  });
  return {
    success: output.success,
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

Deno.test({
  name:
    "raw ./hlvm ask self-starts the local runtime host and renders system-managed delegation",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const port = await findFreePort();
    const hlvmDir = await platform.fs.makeTempDir({ prefix: "hlvm-shell-e2e-" });
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const result = await runLocalAsk(
        port,
        [
          "--fresh",
          "--verbose",
          "--model",
          "ollama/test-fixture",
          "spawn multiple agents and get this parser job done",
        ],
        {
          HLVM_DIR: hlvmDir,
          HLVM_ASK_FIXTURE_PATH: FIXTURE_PATH,
        },
      );

      const output = normalizeCliOutput(result.stdout + result.stderr);
      assertEquals(result.success, true, output);
      assertStringIncludes(output, "[Delegate] code");
      assertStringIncludes(output, "[Team Task] pending Review parser patch");
      assertStringIncludes(output, "[Team Plan Review] requested for task task-review");
      assertStringIncludes(
        output,
        "Result:\nMulti-agent parser coordination complete",
      );

    } finally {
      await shutdownRuntimeHostIfPresent(baseUrl);
      await platform.fs.remove(hlvmDir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "delegation heuristic injects system hint for multi-file concurrent request",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const port = await findFreePort();
    const hlvmDir = await platform.fs.makeTempDir({
      prefix: "hlvm-heuristic-e2e-",
    });
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const result = await runLocalAsk(
        port,
        [
          "--fresh",
          "--verbose",
          "--model",
          "ollama/test-fixture",
          "refactor auth.ts login.ts session.ts config.ts concurrently",
        ],
        {
          HLVM_DIR: hlvmDir,
          HLVM_ASK_FIXTURE_PATH: FIXTURE_PATH,
        },
      );

      const output = normalizeCliOutput(result.stdout + result.stderr);
      // If the fixture expect passes (it checks for [System hint] and fan-out
      // in the messages fed to the LLM), the process exits successfully.
      // A fixture expect mismatch would cause a non-zero exit code.
      assertEquals(
        result.success,
        true,
        `Delegation heuristic e2e failed:\n${output}`,
      );
      assertStringIncludes(output, "[Delegate] code");
      assertStringIncludes(
        output,
        "Result:\nDelegation heuristic test complete",
      );
    } finally {
      await shutdownRuntimeHostIfPresent(baseUrl);
      await platform.fs.remove(hlvmDir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "live local ask smoke test uses natural language to trigger delegation and team coordination",
  ignore: LIVE_MODEL.length === 0,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const port = await findFreePort();
    const hlvmDir = await platform.fs.makeTempDir({ prefix: "hlvm-live-agent-" });
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const result = await runLocalAsk(
        port,
        [
          "--fresh",
          "--verbose",
          "--model",
          LIVE_MODEL,
          "Analyze the parser and agent runtime in this repo. Spawn multiple agents, use team coordination and a plan review before the final answer, do not edit files, and return a synthesis.",
        ],
        {
          HLVM_DIR: hlvmDir,
        },
      );

      const output = normalizeCliOutput(result.stdout + result.stderr);
      assertEquals(result.success, true, output);
      assertEquals(
        output.includes("[Delegate]") || output.includes("delegate "),
        true,
        output,
      );
      assertEquals(
        output.includes("[Team]") || output.includes("[Team Task]"),
        true,
        output,
      );
      assertEquals(output.includes("Result:\n"), true, output);
    } finally {
      await shutdownRuntimeHostIfPresent(baseUrl);
      await platform.fs.remove(hlvmDir, { recursive: true });
    }
  },
});
