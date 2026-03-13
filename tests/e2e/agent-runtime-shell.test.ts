import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { getPlatform } from "../../src/platform/platform.ts";
import { findFreePort } from "../shared/light-helpers.ts";
import { shutdownRuntimeHostIfPresent } from "../shared/runtime-host-test-helpers.ts";

const platform = getPlatform();
const FIXTURE_PATH = platform.path.fromFileUrl(
  new URL("../fixtures/ask/agent-transcript-fixture.json", import.meta.url),
);
const CLI_PATH = platform.path.fromFileUrl(
  new URL("../../src/hlvm/cli/cli.ts", import.meta.url),
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
  cwd?: string,
): Promise<{ success: boolean; stdout: string; stderr: string; code: number }> {
  const cmd = ["deno", "run", "-A", CLI_PATH, "ask", ...args];
  const output = await platform.command.output({
    cmd,
    cwd,
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

function buildLargeFixtureFile(): string {
  return Array.from(
    { length: 130 },
    (_, index) => `line ${index + 1} ${"x".repeat(32)}`,
  ).join("\n");
}

async function createAiLoopEnhancementFixture(
  workspace: string,
): Promise<string> {
  const largeFilePath = platform.path.join(workspace, "large.txt");
  const fixturePath = platform.path.join(
    workspace,
    "agent-ai-loop-enhancements-fixture.json",
  );

  await platform.fs.writeTextFile(largeFilePath, buildLargeFixtureFile());

  const fixture = {
    version: 1,
    name: "agent ai loop enhancement fixture",
    cases: [
      {
        name: "reasoning",
        match: { contains: ["reasoning enhancement smoke"] },
        steps: [
          {
            reasoning: "Inspect the file before acting.",
            toolCalls: [{
              id: "read_1",
              toolName: "read_file",
              args: { path: "large.txt" },
            }],
          },
          { response: "Reasoning enhancement complete" },
        ],
      },
      {
        name: "compression",
        match: { contains: ["compression enhancement smoke"] },
        steps: [
          {
            toolCalls: [{
              id: "read_1",
              toolName: "read_file",
              args: { path: "large.txt" },
            }],
          },
          {
            expect: {
              contains: [
                "File: large.txt",
                "line 1 x",
                "... (20 lines omitted) ...",
                "line 130 x",
              ],
            },
            response: "Compression enhancement complete",
          },
          { response: "Compression enhancement complete" },
        ],
      },
      {
        name: "verify-pass",
        match: { contains: ["verify pass enhancement smoke"] },
        steps: [
          {
            toolCalls: [{
              id: "write_1",
              toolName: "write_file",
              args: {
                path: "valid.ts",
                content: "export const answer: number = 42;\n",
              },
            }],
          },
          {
            expect: { contains: ["Syntax check passed."] },
            response: "Verify pass enhancement complete",
          },
        ],
      },
      {
        name: "verify-fail",
        match: { contains: ["verify fail enhancement smoke"] },
        steps: [
          {
            toolCalls: [{
              id: "write_1",
              toolName: "write_file",
              args: {
                path: "broken.ts",
                content: "export const answer: number = ;\n",
              },
            }],
          },
          {
            expect: { contains: ["Syntax check failed."] },
            response: "Verify fail enhancement complete",
          },
        ],
      },
    ],
  };

  await platform.fs.writeTextFile(
    fixturePath,
    JSON.stringify(fixture, null, 2),
  );
  return fixturePath;
}

async function createAskMultimodalFixture(
  workspace: string,
): Promise<{
  fixturePath: string;
  imagePath: string;
  pdfPath: string;
}> {
  const imagePath = platform.path.join(workspace, "sample.png");
  const pdfPath = platform.path.join(workspace, "sample.pdf");
  const fixturePath = platform.path.join(
    workspace,
    "agent-ask-multimodal-fixture.json",
  );

  await platform.fs.writeFile(
    imagePath,
    new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  );
  await platform.fs.writeFile(
    pdfPath,
    new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"),
  );

  const fixture = {
    version: 1,
    name: "ask multimodal fixture",
    cases: [
      {
        name: "multimodal-ask",
        match: { contains: ["multimodal attachment smoke"] },
        steps: [
          {
            expect: {
              contains: ["multimodal attachment smoke"],
              lastUserAttachmentCount: 2,
              lastUserAttachmentMimeTypes: ["image/png", "application/pdf"],
            },
            response: "Multimodal attachment receipt confirmed",
          },
        ],
      },
    ],
  };

  await platform.fs.writeTextFile(
    fixturePath,
    JSON.stringify(fixture, null, 2),
  );

  return { fixturePath, imagePath, pdfPath };
}

async function withAiLoopEnhancementWorkspace(
  prefix: string,
  fn: (
    context: {
      hlvmDir: string;
      port: number;
      baseUrl: string;
      fixturePath: string;
    },
  ) => Promise<void>,
): Promise<void> {
  const hlvmDir = await platform.fs.makeTempDir({ prefix });
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const fixturePath = await createAiLoopEnhancementFixture(hlvmDir);

  try {
    await fn({ hlvmDir, port, baseUrl, fixturePath });
  } finally {
    await shutdownRuntimeHostIfPresent(baseUrl);
    await platform.fs.remove(hlvmDir, { recursive: true });
  }
}

Deno.test({
  name:
    "local ask command self-starts the runtime host and renders system-managed delegation",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const port = await findFreePort();
    const hlvmDir = await platform.fs.makeTempDir({
      prefix: "hlvm-shell-e2e-",
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
      assertStringIncludes(
        output,
        "[Team Plan Review] requested for task task-review",
      );
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
    "local ask command forwards multimodal attachments through the runtime host",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const port = await findFreePort();
    const hlvmDir = await platform.fs.makeTempDir({
      prefix: "hlvm-multimodal-ask-",
    });
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const { fixturePath, imagePath, pdfPath } =
        await createAskMultimodalFixture(
          hlvmDir,
        );
      const result = await runLocalAsk(
        port,
        [
          "--fresh",
          "--verbose",
          "--attach",
          imagePath,
          "--attach",
          pdfPath,
          "--model",
          "ollama/test-fixture",
          "multimodal attachment smoke",
        ],
        {
          HLVM_DIR: hlvmDir,
          HLVM_ASK_FIXTURE_PATH: fixturePath,
        },
      );

      const output = normalizeCliOutput(result.stdout + result.stderr);
      assertEquals(result.success, true, output);
      assertStringIncludes(
        output,
        "Result:\nMultimodal attachment receipt confirmed",
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
    "raw ./hlvm ask verbose output surfaces provider reasoning distinctly from generic working state",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withAiLoopEnhancementWorkspace(
      "hlvm-ai-loop-reasoning-",
      async ({ hlvmDir, port, fixturePath }) => {
        const result = await runLocalAsk(
          port,
          [
            "--fresh",
            "--verbose",
            "--model",
            "ollama/test-fixture",
            "reasoning enhancement smoke",
          ],
          {
            HLVM_DIR: hlvmDir,
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
          hlvmDir,
        );

        const output = normalizeCliOutput(result.stdout + result.stderr);
        assertEquals(result.success, true, output);
        assertStringIncludes(
          output,
          "[Reasoning] Inspect the file before acting.",
        );
        assertStringIncludes(output, "Result:\nReasoning enhancement complete");
      },
    );
  },
});

Deno.test({
  name:
    "raw ./hlvm ask sends compressed read_file content back into the next LLM step",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withAiLoopEnhancementWorkspace(
      "hlvm-ai-loop-compression-",
      async ({ hlvmDir, port, fixturePath }) => {
        const result = await runLocalAsk(
          port,
          [
            "--fresh",
            "--model",
            "ollama/test-fixture",
            "compression enhancement smoke",
          ],
          {
            HLVM_DIR: hlvmDir,
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
          hlvmDir,
        );

        const output = normalizeCliOutput(result.stdout + result.stderr);
        // The second fixture step asserts the exact compression markers
        // present in the messages fed back to the model. A mismatch makes
        // the CLI exit non-zero.
        assertEquals(result.success, true, output);
        assertStringIncludes(output, "Compression enhancement complete");
      },
    );
  },
});

Deno.test({
  name:
    "raw ./hlvm ask shows syntax verification success to the user after write_file",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withAiLoopEnhancementWorkspace(
      "hlvm-ai-loop-verify-pass-",
      async ({ hlvmDir, port, fixturePath }) => {
        const result = await runLocalAsk(
          port,
          [
            "--fresh",
            "--auto-edit",
            "--verbose",
            "--model",
            "ollama/test-fixture",
            "verify pass enhancement smoke",
          ],
          {
            HLVM_DIR: hlvmDir,
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
          hlvmDir,
        );

        const output = normalizeCliOutput(result.stdout + result.stderr);
        assertEquals(result.success, true, output);
        assertStringIncludes(output, "Syntax check passed.");
        assertStringIncludes(
          output,
          "Result:\nVerify pass enhancement complete",
        );
      },
    );
  },
});

Deno.test({
  name:
    "raw ./hlvm ask shows syntax verification failure to the user after write_file",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withAiLoopEnhancementWorkspace(
      "hlvm-ai-loop-verify-fail-",
      async ({ hlvmDir, port, fixturePath }) => {
        const result = await runLocalAsk(
          port,
          [
            "--fresh",
            "--auto-edit",
            "--verbose",
            "--model",
            "ollama/test-fixture",
            "verify fail enhancement smoke",
          ],
          {
            HLVM_DIR: hlvmDir,
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
          hlvmDir,
        );

        const output = normalizeCliOutput(result.stdout + result.stderr);
        assertEquals(result.success, true, output);
        assertStringIncludes(output, "Syntax check failed.");
        assertStringIncludes(
          output,
          "Result:\nVerify fail enhancement complete",
        );
      },
    );
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
    const hlvmDir = await platform.fs.makeTempDir({
      prefix: "hlvm-live-agent-",
    });
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
