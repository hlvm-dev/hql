import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { getPlatform } from "../../src/platform/platform.ts";
import {
  createSerializedQueue,
  normalizeCliOutput,
  withExclusiveTestResource,
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
import { startBrowserFixtureServer } from "../shared/browser-fixture-server.ts";

const platform = getPlatform();
const CLI_PATH = platform.path.fromFileUrl(
  new URL("../../src/hlvm/cli/cli.ts", import.meta.url),
);
const LIVE_MODEL = platform.env.get("HLVM_LIVE_AGENT_MODEL")?.trim() || "";
const withSerializedLocalAsk = createSerializedQueue();
const withSerializedLocalAskTest = createSerializedQueue();
const allocateRuntimeShellPort = createMonotonicPortAllocator();
const LOCAL_ASK_AUTO_SHUTDOWN_GRACE_MS = 500;

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
  return await withExclusiveTestResource("local-llm-runtime", async () =>
    await withSerializedLocalAsk(async () => {
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
    })
  );
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
                "lines omitted",
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
              contains: ["Tool not available: search_web"],
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

async function createBrowserCliSmokeFixture(workspace: string): Promise<string> {
  const fixturePath = platform.path.join(
    workspace,
    "browser-cli-smoke-fixture.json",
  );
  const fixture = {
    version: 1,
    name: "browser cli smoke fixture",
    cases: [
      {
        name: "browser-cli-smoke",
        match: { contains: ["browser cli smoke"] },
        steps: [
          {
            toolCalls: [{
              id: "pw_goto_1",
              toolName: "pw_goto",
              args: { url: "https://example.com" },
            }],
          },
          {
            toolCalls: [{
              id: "pw_snapshot_1",
              toolName: "pw_snapshot",
              args: {},
            }],
          },
          {
            response: "Browser CLI smoke complete",
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

async function createBrowserCliHybridFixture(
  workspace: string,
  baseUrl: string,
): Promise<string> {
  const fixturePath = platform.path.join(
    workspace,
    "browser-cli-hybrid-fixture.json",
  );
  const fixture = {
    version: 1,
    name: "browser cli hybrid fixture",
    cases: [
      {
        name: "browser-cli-hybrid",
        match: { contains: ["browser cli hybrid smoke"] },
        steps: [
          {
            toolCalls: [{
              id: "pw_goto_1",
              toolName: "pw_goto",
              args: { url: `${baseUrl}/` },
            }],
          },
          {
            toolCalls: [{
              id: "pw_click_1",
              toolName: "pw_click",
              args: { selector: "#submit-btn" },
            }],
          },
          {
            expect: {
              contains: [
                "Playwright confirmed a visible/native blocker intercepted the click.",
                "Call pw_promote now on the next step.",
                "pw_promote",
                "Do not switch to cu_* before pw_promote",
                "pw_click is temporarily blocked",
              ],
            },
            toolCalls: [{
              id: "pw_promote_1",
              toolName: "pw_promote",
              args: {},
            }],
          },
          {
            expect: {
              contains: [
                "After pw_promote, call cu_observe or cu_screenshot before the first desktop action.",
              ],
            },
            toolCalls: [{
              id: "cu_screenshot_1",
              toolName: "cu_screenshot",
              args: {},
            }],
          },
          {
            expect: {
              contains: [
                "cu_screenshot",
                "Browser promoted to visible",
              ],
            },
            toolCalls: [{
              id: "cu_mouse_move_1",
              toolName: "cu_mouse_move",
              args: { coordinate: [10, 10] },
            }],
          },
          {
            response: "Browser CLI hybrid smoke complete",
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
    "local ask command exposes browser_safe Playwright tools through the real browser entry path",
  fn: async () => {
    const port = await allocateRuntimeShellPort();
    const hlvmDir = await platform.fs.makeTempDir({
      prefix: "hlvm-browser-cli-smoke-",
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    const runtimeProbe = createRuntimeHostLifecycleProbe(baseUrl, port);

    try {
      const fixturePath = await createBrowserCliSmokeFixture(hlvmDir);
      const result = await runLocalAsk(
        port,
        [
          "--no-session-persistence",
          "--permission-mode",
          "bypassPermissions",
          "--model",
          "ollama/test-fixture",
          "browser cli smoke: go to https://example.com and tell me the title",
        ],
        {
          HLVM_ASK_FIXTURE_PATH: fixturePath,
        },
        hlvmDir,
        runtimeProbe,
      );

      const output = describeLocalAskResult(result);
      assertEquals(result.success, true, output);
      assertStringIncludes(output, "Browser CLI smoke complete");
    } finally {
      await shutdownRuntimeHostIfPresent(baseUrl, { probe: runtimeProbe });
      await runtimeProbe.stop();
      await platform.fs.remove(hlvmDir, { recursive: true });
    }
  },
});

if (platform.build.os === "darwin") {
  localAskTest({
    name:
      "local ask command deterministically promotes from browser_safe to hybrid before interactive cu_* actions",
    fn: async () => {
      const port = await allocateRuntimeShellPort();
      const hlvmDir = await platform.fs.makeTempDir({
        prefix: "hlvm-browser-cli-hybrid-",
      });
      const baseUrl = `http://127.0.0.1:${port}`;
      const runtimeProbe = createRuntimeHostLifecycleProbe(baseUrl, port);
      const browserFixture = startBrowserFixtureServer();

      try {
        const fixturePath = await createBrowserCliHybridFixture(
          hlvmDir,
          browserFixture.baseUrl,
        );
        const result = await runLocalAsk(
          port,
          [
            "--no-session-persistence",
            "--verbose",
            "--permission-mode",
            "bypassPermissions",
            "--model",
            "ollama/test-fixture",
            "browser cli hybrid smoke: promote after repeated blocked pw_click failures",
          ],
          {
            HLVM_ASK_FIXTURE_PATH: fixturePath,
          },
          hlvmDir,
          runtimeProbe,
        );

        const output = describeLocalAskResult(result);
        assertEquals(result.success, true, output);
        assertStringIncludes(output, "Browser CLI hybrid smoke complete");
      } finally {
        await shutdownRuntimeHostIfPresent(baseUrl, { probe: runtimeProbe });
        await runtimeProbe.stop();
        await browserFixture.server.shutdown();
        await platform.fs.remove(hlvmDir, { recursive: true });
      }
    },
  });
}

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
          "claude-code/test-fixture",
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
          "[TRACE] Iteration 1/20",
        );
        assertStringIncludes(
          output,
          "[TRACE]     - Thinking profile · phase=editing · tools=0 · failures=0",
        );
        assertStringIncludes(
          output,
          "[TRACE] Iteration 2/20",
        );
        assertStringIncludes(
          output,
          "[TRACE]     - Thinking profile · phase=editing · tools=2 · failures=0",
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
    "raw ./hlvm ask recovers when deferred web search is unavailable during edit flow",
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
          "Tool not available: search_web",
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
