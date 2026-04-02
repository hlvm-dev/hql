import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { getPlatform } from "../../src/platform/platform.ts";
import {
  createSerializedQueue,
  normalizeCliOutput,
} from "../shared/light-helpers.ts";
import {
  createMonotonicPortAllocator,
  createRuntimeHostLifecycleProbe,
  formatRuntimeHostLifecycleDiagnostics,
  shutdownRuntimeHostIfPresent,
  waitForRuntimeHostShutdown,
  type RuntimeHostLifecycleDiagnostics,
  type RuntimeHostLifecycleProbe,
} from "../shared/runtime-host-test-helpers.ts";

const platform = getPlatform();
const FIXTURE_PATH = platform.path.fromFileUrl(
  new URL("../fixtures/ask/agent-transcript-fixture.json", import.meta.url),
);
const CLI_PATH = platform.path.fromFileUrl(
  new URL("../../src/hlvm/cli/cli.ts", import.meta.url),
);
const HOOK_RECORDER_PATH = platform.path.fromFileUrl(
  new URL("../fixtures/agent-hook-recorder.ts", import.meta.url),
);
const LIVE_MODEL = platform.env.get("HLVM_LIVE_AGENT_MODEL")?.trim() || "";
const withSerializedLocalAsk = createSerializedQueue();
const withSerializedLocalAskTest = createSerializedQueue();
const allocateRuntimeShellPort = createMonotonicPortAllocator();
const LOCAL_ASK_AUTO_SHUTDOWN_GRACE_MS = 250;

interface LocalAskTestDefinition {
  name: string;
  ignore?: boolean;
  fn: () => void | Promise<void>;
}

function localAskTest(definition: LocalAskTestDefinition): void {
  Deno.test({
    name: definition.name,
    ignore: definition.ignore,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      await withSerializedLocalAskTest(async () => {
        await definition.fn();
      });
    },
  });
}

async function runLocalAsk(
  port: number,
  args: string[],
  env: Record<string, string>,
  cwd?: string,
  runtimeProbe?: RuntimeHostLifecycleProbe,
): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
  lifecycle?: RuntimeHostLifecycleDiagnostics;
}> {
  return await withSerializedLocalAsk(async () => {
    const baseUrl = `http://127.0.0.1:${port}`;
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
    const shutdownObserved = await waitForRuntimeHostShutdown(baseUrl, 5_000);
    if (shutdownObserved) {
      runtimeProbe?.noteShutdownObserved();
      await new Promise((resolve) =>
        setTimeout(resolve, LOCAL_ASK_AUTO_SHUTDOWN_GRACE_MS)
      );
    }
    return {
      success: output.success,
      code: output.code,
      stdout: new TextDecoder().decode(output.stdout),
      stderr: new TextDecoder().decode(output.stderr),
      lifecycle: runtimeProbe?.snapshot(
        new TextDecoder().decode(output.stdout) +
          new TextDecoder().decode(output.stderr),
      ),
    };
  });
}

function describeLocalAskResult(
  result: {
    stdout: string;
    stderr: string;
    lifecycle?: RuntimeHostLifecycleDiagnostics;
  },
): string {
  const output = normalizeCliOutput(result.stdout + result.stderr);
  if (!result.lifecycle) return output;
  const diagnostics = formatRuntimeHostLifecycleDiagnostics(result.lifecycle);
  return output.trim().length > 0 ? `${output}\n\n${diagnostics}` : diagnostics;
}

async function detectNonDenoTypeScriptLspLabel(): Promise<string | null> {
  const candidates = [
    {
      label: "typescript-language-server --stdio",
      cmd: ["typescript-language-server", "--version"],
    },
    {
      label: "vtsls --stdio",
      cmd: ["vtsls", "--version"],
    },
  ];

  for (const candidate of candidates) {
    try {
      await platform.command.output({
        cmd: candidate.cmd,
        stdout: "piped",
        stderr: "piped",
      });
      return candidate.label;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function expectedTypeScriptVerificationPass(
  externalLspLabel?: string | null,
): string {
  return externalLspLabel
    ? `LSP diagnostics passed via ${externalLspLabel}.`
    : "Syntax check passed via tsc --noEmit.";
}

function expectedTypeScriptVerificationFail(
  externalLspLabel?: string | null,
): string {
  return externalLspLabel
    ? `LSP diagnostics via ${externalLspLabel} found 1 error.`
    : "Syntax check failed via tsc --noEmit.";
}

function expectedJavaScriptVerificationPass(
  externalLspLabel?: string | null,
): string {
  return externalLspLabel
    ? `LSP diagnostics passed via ${externalLspLabel}.`
    : "Syntax check passed via node --check.";
}

async function writeProjectHooksConfig(
  workspace: string,
  hooks: Record<string, unknown>,
): Promise<void> {
  const hooksDir = platform.path.join(workspace, ".hlvm");
  await platform.fs.mkdir(hooksDir, { recursive: true });
  await platform.fs.writeTextFile(
    platform.path.join(hooksDir, "hooks.json"),
    JSON.stringify({
      version: 1,
      hooks,
    }, null, 2),
  );
}

function parseJsonLines(text: string): unknown[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function buildLargeFixtureFile(): string {
  return Array.from(
    { length: 130 },
    (_, index) => `line ${index + 1} ${"x".repeat(32)}`,
  ).join("\n");
}

async function createAiLoopEnhancementFixture(
  workspace: string,
  externalTypeScriptLspLabel?: string | null,
): Promise<string> {
  const largeFilePath = platform.path.join(workspace, "large.txt");
  const phaseFilePath = platform.path.join(workspace, "src.js");
  const loopFilePath = platform.path.join(workspace, "loop.txt");
  const fixturePath = platform.path.join(
    workspace,
    "agent-ai-loop-enhancements-fixture.json",
  );

  await platform.fs.writeTextFile(largeFilePath, buildLargeFixtureFile());
  await platform.fs.writeTextFile(
    phaseFilePath,
    "export const value = 1;\n",
  );
  await platform.fs.writeTextFile(loopFilePath, "loop target\n");

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
        match: { contains: ["write verify pass enhancement smoke"] },
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
            expect: {
              contains: [
                expectedTypeScriptVerificationPass(externalTypeScriptLspLabel),
              ],
            },
            response: "Verify pass enhancement complete",
          },
        ],
      },
      {
        name: "verify-fail",
        match: { contains: ["write verify fail enhancement smoke"] },
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
            expect: {
              contains: [
                expectedTypeScriptVerificationFail(externalTypeScriptLspLabel),
              ],
            },
            response: "Verify fail enhancement complete",
          },
        ],
      },
      {
        name: "lsp-verify-pass",
        match: { contains: ["write lsp verify pass enhancement smoke"] },
        steps: [
          {
            toolCalls: [{
              id: "write_lsp_pass_1",
              toolName: "write_file",
              args: {
                path: "typed-valid.ts",
                content: "export const answer: number = 42;\n",
              },
            }],
          },
          {
            expect: { contains: ["LSP diagnostics passed via deno lsp."] },
            response: "LSP verify pass enhancement complete",
          },
        ],
      },
      {
        name: "lsp-verify-fail",
        match: { contains: ["write lsp verify fail enhancement smoke"] },
        steps: [
          {
            toolCalls: [{
              id: "write_lsp_fail_1",
              toolName: "write_file",
              args: {
                path: "typed-broken.ts",
                content: "export const answer: number = \"forty-two\";\n",
              },
            }],
          },
          {
            expect: {
              contains: [
                "LSP diagnostics via deno lsp found 1 error.",
                "Type 'string' is not assignable to type 'number'.",
              ],
            },
            response: "LSP verify fail enhancement complete",
          },
        ],
      },
      {
        name: "phase-pruning",
        match: { contains: ["fix phase pruning enhancement smoke"] },
        steps: [
          {
            toolCalls: [{
              id: "read_1",
              toolName: "read_file",
              args: { path: "src.js" },
            }],
          },
          {
            toolCalls: [{
              id: "web_1",
              toolName: "search_web",
              args: { query: "rename javascript const" },
            }],
          },
          {
            expect: {
              contains: ["Tool not allowed by orchestrator: search_web"],
            },
            toolCalls: [{
              id: "edit_1",
              toolName: "edit_file",
              args: {
                path: "src.js",
                find: "export const value = 1;",
                replace: "export const nextValue = 1;",
              },
            }],
          },
          {
            expect: {
              contains: [
                expectedJavaScriptVerificationPass(externalTypeScriptLspLabel),
              ],
            },
            response: "Phase pruning enhancement complete",
          },
        ],
      },
      {
        name: "external-lsp-verify-pass",
        match: { contains: ["write external lsp verify pass enhancement smoke"] },
        steps: [
          {
            toolCalls: [{
              id: "write_external_lsp_pass_1",
              toolName: "write_file",
              args: {
                path: "typed-external-valid.ts",
                content: "export const answer: number = 42;\n",
              },
            }],
          },
          {
            expect: { contains: ["LSP diagnostics passed via"] },
            response: "External LSP verify pass enhancement complete",
          },
        ],
      },
      {
        name: "external-lsp-verify-fail",
        match: { contains: ["write external lsp verify fail enhancement smoke"] },
        steps: [
          {
            toolCalls: [{
              id: "write_external_lsp_fail_1",
              toolName: "write_file",
              args: {
                path: "typed-external-broken.ts",
                content: "export const answer: number = \"forty-two\";\n",
              },
            }],
          },
          {
            expect: {
              contains: [
                "LSP diagnostics via",
                "Type 'string' is not assignable to type 'number'.",
              ],
            },
            response: "External LSP verify fail enhancement complete",
          },
        ],
      },
      {
        name: "hooks",
        match: { contains: ["hooks enhancement smoke"] },
        steps: [
          {
            toolCalls: [{
              id: "hooks_read_1",
              toolName: "read_file",
              args: { path: "large.txt" },
            }],
          },
          {
            response: "Hooks enhancement complete",
          },
        ],
      },
      {
        name: "continuation-metadata",
        match: { contains: ["continuation metadata enhancement smoke"] },
        steps: [
          {
            response:
              "RESILIENCE-CONTINUATION-HEADER\n1. fruit-1\n2. fruit-2\n3. fruit-3\n4. fruit-4\n",
            completionState: "truncated_max_tokens",
          },
          {
            response:
              "4. fruit-4\n5. fruit-5\n6. fruit-6\n",
          },
        ],
      },
      {
        name: "proactive-compaction-metadata",
        match: { contains: ["proactive compaction metadata enhancement smoke"] },
        steps: [
          {
            toolCalls: [{
              id: "compaction_read_1",
              toolName: "read_file",
              args: { path: "large.txt" },
            }],
          },
          {
            expect: { contains: ["Summary of earlier context:"] },
            response: "Compaction metadata enhancement complete",
          },
          {
            response: "Compaction metadata enhancement complete",
          },
          {
            response: "Compaction metadata enhancement complete",
          },
        ],
      },
      {
        name: "adaptive-thinking",
        match: { contains: ["fix adaptive thinking enhancement smoke"] },
        steps: [
          {
            toolCalls: [
              {
                id: "read_1",
                toolName: "read_file",
                args: { path: "src.js" },
              },
              {
                id: "search_1",
                toolName: "search_code",
                args: { pattern: "value" },
              },
            ],
          },
          {
            response: "Adaptive thinking enhancement complete",
          },
        ],
      },
      {
        name: "loop-recovery",
        match: { contains: ["loop recovery enhancement smoke"] },
        steps: [
          {
            toolCalls: [{
              id: "search_1",
              toolName: "read_file",
              args: { path: "loop.txt" },
            }],
          },
          {
            toolCalls: [{
              id: "search_2",
              toolName: "read_file",
              args: { path: "loop.txt" },
            }],
          },
          {
            toolCalls: [{
              id: "search_3",
              toolName: "read_file",
              args: { path: "loop.txt" },
            }],
          },
          {
            expect: { contains: ["Change approach now"] },
            toolCalls: [{
              id: "search_4",
              toolName: "read_file",
              args: { path: "loop.txt" },
            }],
          },
          {
            expect: { contains: ["temporarily blocked"] },
            response: "Loop recovery enhancement complete",
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
      runtimeProbe: RuntimeHostLifecycleProbe;
    },
  ) => Promise<void>,
): Promise<void> {
  const hlvmDir = await platform.fs.makeTempDir({ prefix });
  const port = await allocateRuntimeShellPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runtimeProbe = createRuntimeHostLifecycleProbe(baseUrl, port);
  const externalTypeScriptLspLabel = await detectNonDenoTypeScriptLspLabel();
  const fixturePath = await createAiLoopEnhancementFixture(
    hlvmDir,
    externalTypeScriptLspLabel,
  );

  try {
    await fn({ hlvmDir, port, baseUrl, fixturePath, runtimeProbe });
  } finally {
    await shutdownRuntimeHostIfPresent(baseUrl, { probe: runtimeProbe });
    await runtimeProbe.stop();
    await platform.fs.remove(hlvmDir, { recursive: true });
  }
}

localAskTest({
  name:
    "local ask command self-starts the runtime host and renders system-managed delegation",
  fn: async () => {
    const port = await allocateRuntimeShellPort();
    const hlvmDir = await platform.fs.makeTempDir({
      prefix: "hlvm-shell-e2e-",
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    const runtimeProbe = createRuntimeHostLifecycleProbe(baseUrl, port);

    try {
      const result = await runLocalAsk(
        port,
        [
          "--no-session-persistence",
          "--verbose",
          "--model",
          "ollama/test-fixture",
          "spawn multiple agents and get this parser job done",
        ],
        {
          HLVM_DIR: hlvmDir,
          HLVM_ASK_FIXTURE_PATH: FIXTURE_PATH,
        },
        undefined,
        runtimeProbe,
      );

      const output = describeLocalAskResult(result);
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
      await shutdownRuntimeHostIfPresent(baseUrl, { probe: runtimeProbe });
      await runtimeProbe.stop();
      await platform.fs.remove(hlvmDir, { recursive: true });
    }
  },
});

localAskTest({
  name:
    "local ask command forwards multimodal attachments through the runtime host",
  fn: async () => {
    const port = await allocateRuntimeShellPort();
    const hlvmDir = await platform.fs.makeTempDir({
      prefix: "hlvm-multimodal-ask-",
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    const runtimeProbe = createRuntimeHostLifecycleProbe(baseUrl, port);

    try {
      const { fixturePath, imagePath, pdfPath } =
        await createAskMultimodalFixture(
          hlvmDir,
        );
      const result = await runLocalAsk(
        port,
        [
          "--no-session-persistence",
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
        undefined,
        runtimeProbe,
      );

      const output = describeLocalAskResult(result);
      assertEquals(result.success, true, output);
      assertStringIncludes(
        output,
        "Result:\nMultimodal attachment receipt confirmed",
      );
    } finally {
      await shutdownRuntimeHostIfPresent(baseUrl, { probe: runtimeProbe });
      await runtimeProbe.stop();
      await platform.fs.remove(hlvmDir, { recursive: true });
    }
  },
});

localAskTest({
  name:
    "delegation heuristic injects system hint for multi-file concurrent request",
  fn: async () => {
    const port = await allocateRuntimeShellPort();
    const hlvmDir = await platform.fs.makeTempDir({
      prefix: "hlvm-heuristic-e2e-",
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    const runtimeProbe = createRuntimeHostLifecycleProbe(baseUrl, port);

    try {
      const result = await runLocalAsk(
        port,
        [
          "--no-session-persistence",
          "--verbose",
          "--model",
          "ollama/test-fixture",
          "refactor auth.ts login.ts session.ts config.ts concurrently",
        ],
        {
          HLVM_DIR: hlvmDir,
          HLVM_ASK_FIXTURE_PATH: FIXTURE_PATH,
        },
        undefined,
        runtimeProbe,
      );

      const output = describeLocalAskResult(result);
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
      await shutdownRuntimeHostIfPresent(baseUrl, { probe: runtimeProbe });
      await runtimeProbe.stop();
      await platform.fs.remove(hlvmDir, { recursive: true });
    }
  },
});

localAskTest({
  name:
    "raw ./hlvm ask verbose output surfaces provider reasoning distinctly from generic working state",
  fn: async () => {
    await withAiLoopEnhancementWorkspace(
      "hlvm-ai-loop-reasoning-",
      async ({ hlvmDir, port, fixturePath, runtimeProbe }) => {
        const result = await runLocalAsk(
          port,
          [
            "--no-session-persistence",
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
          runtimeProbe,
        );

        const output = describeLocalAskResult(result);
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

localAskTest({
  name:
    "raw ./hlvm ask sends compressed read_file content back into the next LLM step",
  fn: async () => {
    await withAiLoopEnhancementWorkspace(
      "hlvm-ai-loop-compression-",
      async ({ hlvmDir, port, fixturePath, runtimeProbe }) => {
        const result = await runLocalAsk(
          port,
          [
            "--no-session-persistence",
            "--model",
            "ollama/test-fixture",
            "compression enhancement smoke",
          ],
          {
            HLVM_DIR: hlvmDir,
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
          hlvmDir,
          runtimeProbe,
        );

        const output = describeLocalAskResult(result);
        // The second fixture step asserts the exact compression markers
        // present in the messages fed back to the model. A mismatch makes
        // the CLI exit non-zero.
        assertEquals(result.success, true, output);
        assertStringIncludes(output, "Compression enhancement complete");
      },
    );
  },
});

localAskTest({
  name:
    "raw ./hlvm ask shows syntax verification success to the user after write_file",
  fn: async () => {
    await withAiLoopEnhancementWorkspace(
      "hlvm-ai-loop-verify-pass-",
      async ({ hlvmDir, port, fixturePath, runtimeProbe }) => {
        const externalTypeScriptLspLabel = await detectNonDenoTypeScriptLspLabel();
        const result = await runLocalAsk(
          port,
          [
            "--no-session-persistence",
            "--permission-mode", "acceptEdits",
            "--verbose",
            "--model",
            "ollama/test-fixture",
            "write verify pass enhancement smoke",
          ],
          {
            HLVM_DIR: hlvmDir,
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
          hlvmDir,
          runtimeProbe,
        );

        const output = describeLocalAskResult(result);
        assertEquals(result.success, true, output);
        assertStringIncludes(
          output,
          expectedTypeScriptVerificationPass(externalTypeScriptLspLabel),
        );
        assertStringIncludes(
          output,
          "Result:\nVerify pass enhancement complete",
        );
      },
    );
  },
});

localAskTest({
  name:
    "raw ./hlvm ask shows syntax verification failure to the user after write_file",
  fn: async () => {
    await withAiLoopEnhancementWorkspace(
      "hlvm-ai-loop-verify-fail-",
      async ({ hlvmDir, port, fixturePath, runtimeProbe }) => {
        const externalTypeScriptLspLabel = await detectNonDenoTypeScriptLspLabel();
        const result = await runLocalAsk(
          port,
          [
            "--no-session-persistence",
            "--permission-mode", "acceptEdits",
            "--verbose",
            "--model",
            "ollama/test-fixture",
            "write verify fail enhancement smoke",
          ],
          {
            HLVM_DIR: hlvmDir,
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
          hlvmDir,
          runtimeProbe,
        );

        const output = describeLocalAskResult(result);
        assertEquals(result.success, true, output);
        assertStringIncludes(
          output,
          expectedTypeScriptVerificationFail(externalTypeScriptLspLabel),
        );
        assertStringIncludes(
          output,
          "Result:\nVerify fail enhancement complete",
        );
      },
    );
  },
});

localAskTest({
  name:
    "raw ./hlvm ask shows LSP diagnostics success to the user after write_file",
  fn: async () => {
    await withAiLoopEnhancementWorkspace(
      "hlvm-ai-loop-lsp-verify-pass-",
      async ({ hlvmDir, port, fixturePath, runtimeProbe }) => {
        await platform.fs.writeTextFile(
          platform.path.join(hlvmDir, "deno.json"),
          "{}\n",
        );

        const result = await runLocalAsk(
          port,
          [
            "--no-session-persistence",
            "--permission-mode", "acceptEdits",
            "--verbose",
            "--model",
            "ollama/test-fixture",
            "write lsp verify pass enhancement smoke",
          ],
          {
            HLVM_DIR: hlvmDir,
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
          hlvmDir,
          runtimeProbe,
        );

        const output = describeLocalAskResult(result);
        assertEquals(result.success, true, output);
        assertStringIncludes(output, "LSP diagnostics passed via deno lsp.");
        assertStringIncludes(
          output,
          "Result:\nLSP verify pass enhancement complete",
        );
      },
    );
  },
});

localAskTest({
  name:
    "raw ./hlvm ask shows LSP diagnostics failure to the user after write_file",
  fn: async () => {
    await withAiLoopEnhancementWorkspace(
      "hlvm-ai-loop-lsp-verify-fail-",
      async ({ hlvmDir, port, fixturePath, runtimeProbe }) => {
        await platform.fs.writeTextFile(
          platform.path.join(hlvmDir, "deno.json"),
          "{}\n",
        );

        const result = await runLocalAsk(
          port,
          [
            "--no-session-persistence",
            "--permission-mode", "acceptEdits",
            "--verbose",
            "--model",
            "ollama/test-fixture",
            "write lsp verify fail enhancement smoke",
          ],
          {
            HLVM_DIR: hlvmDir,
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
          hlvmDir,
          runtimeProbe,
        );

        const output = describeLocalAskResult(result);
        assertEquals(result.success, true, output);
        assertStringIncludes(
          output,
          "LSP diagnostics via deno lsp found 1 error.",
        );
        assertStringIncludes(
          output,
          "Type 'string' is not assignable to type 'number'.",
        );
        assertStringIncludes(
          output,
          "Result:\nLSP verify fail enhancement complete",
        );
      },
    );
  },
});

localAskTest({
  name:
    "raw ./hlvm ask keeps the local runtime host stable across sequential deno LSP pass then fail checks",
  fn: async () => {
    await withAiLoopEnhancementWorkspace(
      "hlvm-ai-loop-lsp-sequential-",
      async ({ hlvmDir, port, fixturePath, runtimeProbe }) => {
        await platform.fs.writeTextFile(
          platform.path.join(hlvmDir, "deno.json"),
          "{}\n",
        );

        const passResult = await runLocalAsk(
          port,
          [
            "--no-session-persistence",
            "--permission-mode", "acceptEdits",
            "--verbose",
            "--model",
            "ollama/test-fixture",
            "write lsp verify pass enhancement smoke",
          ],
          {
            HLVM_DIR: hlvmDir,
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
          hlvmDir,
          runtimeProbe,
        );

        const passOutput = describeLocalAskResult(passResult);
        assertEquals(passResult.success, true, passOutput);
        assertStringIncludes(passOutput, "LSP diagnostics passed via deno lsp.");

        const failResult = await runLocalAsk(
          port,
          [
            "--no-session-persistence",
            "--permission-mode", "acceptEdits",
            "--verbose",
            "--model",
            "ollama/test-fixture",
            "write lsp verify fail enhancement smoke",
          ],
          {
            HLVM_DIR: hlvmDir,
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
          hlvmDir,
          runtimeProbe,
        );

        const failOutput = describeLocalAskResult(failResult);
        assertEquals(failResult.success, true, failOutput);
        assertStringIncludes(
          failOutput,
          "LSP diagnostics via deno lsp found 1 error.",
        );
        assertStringIncludes(
          failOutput,
          "Type 'string' is not assignable to type 'number'.",
        );
        assertEquals(
          failOutput.includes("[HLVM5009]"),
          false,
          failOutput,
        );
      },
    );
  },
});

localAskTest({
  name:
    "raw ./hlvm ask executes project lifecycle hooks and records tool/final events",
  fn: async () => {
    await withAiLoopEnhancementWorkspace(
      "hlvm-ai-loop-hooks-",
      async ({ hlvmDir, port, fixturePath, runtimeProbe }) => {
        const hookLogPath = platform.path.join(hlvmDir, "hook-log.jsonl");
        await writeProjectHooksConfig(hlvmDir, {
          pre_tool: [{
            command: [Deno.execPath(), "run", "-A", HOOK_RECORDER_PATH, hookLogPath],
          }],
          post_tool: [{
            command: [Deno.execPath(), "run", "-A", HOOK_RECORDER_PATH, hookLogPath],
          }],
          final_response: [{
            command: [Deno.execPath(), "run", "-A", HOOK_RECORDER_PATH, hookLogPath],
          }],
        });

        const result = await runLocalAsk(
          port,
          [
            "--no-session-persistence",
            "--verbose",
            "--model",
            "ollama/test-fixture",
            "hooks enhancement smoke",
          ],
          {
            HLVM_DIR: hlvmDir,
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
          hlvmDir,
          runtimeProbe,
        );

        const output = describeLocalAskResult(result);
        assertEquals(result.success, true, output);
        assertStringIncludes(output, "Result:\nHooks enhancement complete");

        const hookLog = await platform.fs.readTextFile(hookLogPath);
        const events = parseJsonLines(hookLog) as Array<{
          hook: string;
          payload?: Record<string, unknown>;
        }>;
        assertEquals(
          events.map((event) => event.hook),
          ["pre_tool", "post_tool", "final_response"],
        );
        assertEquals(events[0]?.payload?.toolName, "read_file");
        assertEquals(typeof events[0]?.payload?.toolCallId, "string");
        assertEquals(events[1]?.payload?.toolName, "read_file");
        assertEquals(events[1]?.payload?.presentationKind, "read");
        assertEquals(typeof events[2]?.payload?.turnId, "string");
        assertEquals(events[2]?.payload?.text, "Hooks enhancement complete");
      },
    );
  },
});

localAskTest({
  name:
    "raw ./hlvm ask stream-json reports continuation metadata through the local runtime host",
  fn: async () => {
    await withAiLoopEnhancementWorkspace(
      "hlvm-ai-loop-runtime-metadata-",
      async ({ hlvmDir, port, fixturePath, runtimeProbe }) => {
        const hookLogPath = platform.path.join(
          hlvmDir,
          "runtime-metadata-hook-log.jsonl",
        );
        await writeProjectHooksConfig(hlvmDir, {
          final_response: [{
            command: [Deno.execPath(), "run", "-A", HOOK_RECORDER_PATH, hookLogPath],
          }],
        });

        const continuationResult = await runLocalAsk(
          port,
          [
            "--no-session-persistence",
            "--output-format", "stream-json",
            "--model",
            "ollama/test-fixture",
            "continuation metadata enhancement smoke",
          ],
          {
            HLVM_DIR: hlvmDir,
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
          hlvmDir,
          runtimeProbe,
        );

        const continuationOutput = normalizeCliOutput(
          continuationResult.stdout + continuationResult.stderr,
        ).trim();
        assertEquals(continuationResult.success, true, continuationOutput);

        const continuationLines = continuationOutput
          .split("\n")
          .filter(Boolean)
          .map((line) =>
            JSON.parse(line) as {
              type: string;
              event?: {
                type?: string;
                continuedThisTurn?: boolean;
                continuationCount?: number;
              };
              text?: string;
            }
          );
        const continuationFinal = continuationLines.find((line) =>
          line.type === "final"
        );
        const continuationStats = continuationLines.find((line) =>
          line.type === "agent_event" && line.event?.type === "turn_stats"
        );
        assertEquals(typeof continuationFinal?.text, "string");
        assertEquals(continuationStats?.event?.continuedThisTurn, true);
        assertEquals(continuationStats?.event?.continuationCount, 1);

        const hookEvents = parseJsonLines(
          await platform.fs.readTextFile(hookLogPath),
        ) as Array<{
          hook: string;
          payload?: Record<string, unknown>;
        }>;
        const continuationFinalHook = hookEvents.find((event) =>
          event.hook === "final_response"
        );
        const mergedText = String(continuationFinalHook?.payload?.text ?? "");
        assertStringIncludes(mergedText, "RESILIENCE-CONTINUATION-HEADER");
        assertEquals(
          mergedText.split("RESILIENCE-CONTINUATION-HEADER").length - 1,
          1,
        );
      },
    );
  },
});

localAskTest({
  name:
    "raw ./hlvm ask uses a non-Deno TypeScript language server when one is installed",
  fn: async () => {
    const lspLabel = await detectNonDenoTypeScriptLspLabel();
    if (!lspLabel) return;

    await withAiLoopEnhancementWorkspace(
      "hlvm-ai-loop-external-lsp-",
      async ({ hlvmDir, port, fixturePath, runtimeProbe }) => {
        await platform.fs.writeTextFile(
          platform.path.join(hlvmDir, "tsconfig.json"),
          "{\n  \"compilerOptions\": {\n    \"strict\": true\n  }\n}\n",
        );

        const passResult = await runLocalAsk(
          port,
          [
            "--no-session-persistence",
            "--permission-mode", "acceptEdits",
            "--verbose",
            "--model",
            "ollama/test-fixture",
            "write external lsp verify pass enhancement smoke",
          ],
          {
            HLVM_DIR: hlvmDir,
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
          hlvmDir,
          runtimeProbe,
        );

        const passOutput = describeLocalAskResult(passResult);
        assertEquals(passResult.success, true, passOutput);
        assertStringIncludes(passOutput, `LSP diagnostics passed via ${lspLabel}.`);
        assertStringIncludes(
          passOutput,
          "Result:\nExternal LSP verify pass enhancement complete",
        );

        const failResult = await runLocalAsk(
          port,
          [
            "--no-session-persistence",
            "--permission-mode", "acceptEdits",
            "--verbose",
            "--model",
            "ollama/test-fixture",
            "write external lsp verify fail enhancement smoke",
          ],
          {
            HLVM_DIR: hlvmDir,
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
          hlvmDir,
          runtimeProbe,
        );

        const failOutput = describeLocalAskResult(failResult);
        assertEquals(failResult.success, true, failOutput);
        assertStringIncludes(
          failOutput,
          `LSP diagnostics via ${lspLabel} found 1 error.`,
        );
        assertStringIncludes(
          failOutput,
          "Type 'string' is not assignable to type 'number'.",
        );
        assertStringIncludes(
          failOutput,
          "Result:\nExternal LSP verify fail enhancement complete",
        );
      },
    );
  },
});

localAskTest({
  name: "raw ./hlvm ask shows adaptive thinking profile changing across turns",
  fn: async () => {
    await withAiLoopEnhancementWorkspace(
      "hlvm-ai-loop-thinking-",
      async ({ hlvmDir, port, fixturePath, runtimeProbe }) => {
        const result = await runLocalAsk(
          port,
          [
            "--no-session-persistence",
            "--verbose",
            "--model",
            "openai/o3",
            "fix adaptive thinking enhancement smoke",
          ],
          {
            HLVM_DIR: hlvmDir,
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
          hlvmDir,
          runtimeProbe,
        );

        const output = describeLocalAskResult(result);
        assertEquals(result.success, true, output);
        assertStringIncludes(
          output,
          "[TRACE] Thinking profile: iteration=1 phase=editing openai=low",
        );
        assertStringIncludes(
          output,
          "[TRACE] Thinking profile: iteration=2 phase=editing openai=medium",
        );
        assertStringIncludes(
          output,
          "Result:\nAdaptive thinking enhancement complete",
        );
      },
    );
  },
});

localAskTest({
  name:
    "raw ./hlvm ask blocks irrelevant web search once phase pruning enters edit mode",
  fn: async () => {
    await withAiLoopEnhancementWorkspace(
      "hlvm-ai-loop-phase-pruning-",
      async ({ hlvmDir, port, fixturePath, runtimeProbe }) => {
        const result = await runLocalAsk(
          port,
          [
            "--no-session-persistence",
            "--permission-mode", "acceptEdits",
            "--verbose",
            "--model",
            "ollama/test-fixture",
            "fix phase pruning enhancement smoke",
          ],
          {
            HLVM_DIR: hlvmDir,
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
          hlvmDir,
          runtimeProbe,
        );

        const output = describeLocalAskResult(result);
        assertEquals(result.success, true, output);
        assertStringIncludes(
          output,
          "Tool not allowed by orchestrator: search_web",
        );
        assertStringIncludes(
          output,
          "Result:\nPhase pruning enhancement complete",
        );
      },
    );
  },
});

localAskTest({
  name: "raw ./hlvm ask recovers from a repeated search loop before giving up",
  fn: async () => {
    await withAiLoopEnhancementWorkspace(
      "hlvm-ai-loop-recovery-",
      async ({ hlvmDir, port, fixturePath, runtimeProbe }) => {
        const result = await runLocalAsk(
          port,
          [
            "--no-session-persistence",
            "--verbose",
            "--model",
            "ollama/test-fixture",
            "loop recovery enhancement smoke",
          ],
          {
            HLVM_DIR: hlvmDir,
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
          hlvmDir,
          runtimeProbe,
        );

        const output = describeLocalAskResult(result);
        assertEquals(result.success, true, output);
        assertStringIncludes(
          output,
          "Result:\nLoop recovery enhancement complete",
        );
      },
    );
  },
});

localAskTest({
  name:
    "live local ask smoke test uses natural language to trigger delegation and team coordination",
  ignore: LIVE_MODEL.length === 0,
  fn: async () => {
    const port = await allocateRuntimeShellPort();
    const hlvmDir = await platform.fs.makeTempDir({
      prefix: "hlvm-live-agent-",
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    const runtimeProbe = createRuntimeHostLifecycleProbe(baseUrl, port);

    try {
      const result = await runLocalAsk(
        port,
        [
          "--no-session-persistence",
          "--verbose",
          "--model",
          LIVE_MODEL,
          "Analyze the parser and agent runtime in this repo. Spawn multiple agents, use team coordination and a plan review before the final answer, do not edit files, and return a synthesis.",
        ],
        {
          HLVM_DIR: hlvmDir,
        },
        undefined,
        runtimeProbe,
      );

      const output = describeLocalAskResult(result);
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
      await shutdownRuntimeHostIfPresent(baseUrl, { probe: runtimeProbe });
      await runtimeProbe.stop();
      await platform.fs.remove(hlvmDir, { recursive: true });
    }
  },
});
