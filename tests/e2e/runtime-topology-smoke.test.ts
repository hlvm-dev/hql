import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import { getPlatform } from "../../src/platform/platform.ts";
import { __testOnlyGetRuntimeStartLockPath } from "../../src/hlvm/runtime/host-client.ts";
import {
  withExclusiveTestResource,
  normalizeCliOutput,
} from "../shared/light-helpers.ts";

const platform = getPlatform();
const RUN_TOPOLOGY_SMOKE = platform.env.get("HLVM_E2E_RUNTIME_TOPOLOGY") ===
  "1";
const GUI_APP_PATH = platform.env.get("HLVM_E2E_GUI_APP_PATH")?.trim() || "";
const HOME = platform.env.get("HOME") ?? "";
const REPO_ROOT = platform.path.fromFileUrl(
  new URL("../..", import.meta.url),
);
const REPO_BINARY_PATH = platform.path.join(REPO_ROOT, "hlvm");
const SOURCE_CLI_PATH = platform.path.join(
  REPO_ROOT,
  "src",
  "hlvm",
  "cli",
  "cli.ts",
);
const MANAGED_OLLAMA_PATH = platform.path.join(
  HOME,
  ".hlvm",
  ".runtime",
  "engine",
  "ollama",
);
const GUI_APP_EXECUTABLE_PATH = GUI_APP_PATH
  ? platform.path.join(
    GUI_APP_PATH,
    "Contents",
    "MacOS",
    platform.path.basename(GUI_APP_PATH, ".app"),
  )
  : "";
const GUI_APP_RUNTIME_PATH = GUI_APP_PATH
  ? platform.path.join(
    GUI_APP_PATH,
    "Contents",
    "Resources",
    "hlvm",
  )
  : "";
const GUI_LAUNCH_SETTLE_MS = 2_000;
const PROCESS_EXIT_WAIT_MS = 5_000;
const PROCESS_EXIT_POLL_MS = 100;

interface CommandResult {
  success: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

interface ProcessEntry {
  pid: string;
  command: string;
}

interface RuntimeTopologySnapshot {
  repoServe: ProcessEntry[];
  sourceServe: ProcessEntry[];
  bundledServe: ProcessEntry[];
  guiApp: ProcessEntry[];
  managedOllama: ProcessEntry[];
  listeners: string[];
}

function liveTopologyTest(
  name: string,
  fn: () => Promise<void>,
): void {
  Deno.test({
    name,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      if (!RUN_TOPOLOGY_SMOKE) {
        return;
      }
      if (platform.build.os !== "darwin") {
        return;
      }
      await withExclusiveTestResource("live-runtime-topology", fn);
    },
  });
}

async function runCommand(
  cmd: string[],
  env?: Record<string, string>,
): Promise<CommandResult> {
  const output = await platform.command.output({
    cmd,
    env: env ? { ...platform.env.toObject(), ...env } : undefined,
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

async function pgrepEntries(pattern: string): Promise<ProcessEntry[]> {
  const output = await runCommand(["pgrep", "-fal", pattern]);
  if (!output.success) {
    return [];
  }
  const entries = output.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pid, ...rest] = line.split(/\s+/);
      return { pid, command: rest.join(" ") };
    });
  const liveEntries: ProcessEntry[] = [];
  for (const entry of entries) {
    if (await isZombieProcess(entry.pid)) {
      continue;
    }
    liveEntries.push(entry);
  }
  return liveEntries;
}

async function readListenerLines(): Promise<string[]> {
  const output = await runCommand([
    "lsof",
    "-nP",
    "-iTCP:11435",
    "-iTCP:11439",
    "-sTCP:LISTEN",
  ]);
  if (!output.success) {
    return [];
  }
  return output.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("COMMAND"));
}

async function readRuntimeTopologySnapshot(): Promise<RuntimeTopologySnapshot> {
  return {
    repoServe: await pgrepEntries(`${REPO_BINARY_PATH} serve`),
    sourceServe: await pgrepEntries(`${SOURCE_CLI_PATH} serve`),
    bundledServe: GUI_APP_RUNTIME_PATH
      ? await pgrepEntries(`${GUI_APP_RUNTIME_PATH} serve`)
      : [],
    guiApp: GUI_APP_EXECUTABLE_PATH
      ? await pgrepEntries(GUI_APP_EXECUTABLE_PATH)
      : [],
    managedOllama: await pgrepEntries(`${MANAGED_OLLAMA_PATH} serve`),
    listeners: await readListenerLines(),
  };
}

function formatSnapshot(snapshot: RuntimeTopologySnapshot): string {
  return [
    `repoServe=${snapshot.repoServe.map((entry) => `${entry.pid}:${entry.command}`).join(" | ") || "none"}`,
    `sourceServe=${snapshot.sourceServe.map((entry) => `${entry.pid}:${entry.command}`).join(" | ") || "none"}`,
    `bundledServe=${snapshot.bundledServe.map((entry) => `${entry.pid}:${entry.command}`).join(" | ") || "none"}`,
    `guiApp=${snapshot.guiApp.map((entry) => `${entry.pid}:${entry.command}`).join(" | ") || "none"}`,
    `managedOllama=${snapshot.managedOllama.map((entry) => `${entry.pid}:${entry.command}`).join(" | ") || "none"}`,
    `listeners=${snapshot.listeners.join(" | ") || "none"}`,
  ].join("\n");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function isZombieProcess(pid: string): Promise<boolean> {
  const result = await runCommand(["ps", "-p", pid, "-o", "stat="]);
  if (!result.success) {
    return false;
  }
  const stat = result.stdout.trim();
  return stat.startsWith("Z");
}

function uniquePids(snapshot: RuntimeTopologySnapshot): string[] {
  return Array.from(
    new Set([
      ...snapshot.repoServe.map((entry) => entry.pid),
      ...snapshot.sourceServe.map((entry) => entry.pid),
      ...snapshot.bundledServe.map((entry) => entry.pid),
      ...snapshot.guiApp.map((entry) => entry.pid),
      ...snapshot.managedOllama.map((entry) => entry.pid),
    ]),
  );
}

async function terminateProcesses(pids: string[]): Promise<void> {
  if (pids.length === 0) {
    return;
  }
  await runCommand(["kill", ...pids]);
  const waitForExit = async (): Promise<string[]> => {
    const deadline = Date.now() + PROCESS_EXIT_WAIT_MS;
    while (Date.now() < deadline) {
      const stillRunning = new Set(uniquePids(await readRuntimeTopologySnapshot()));
      const remaining = pids.filter((pid) => stillRunning.has(pid));
      if (remaining.length === 0) {
        return [];
      }
      await sleep(PROCESS_EXIT_POLL_MS);
    }
    const stillRunning = new Set(uniquePids(await readRuntimeTopologySnapshot()));
    return pids.filter((pid) => stillRunning.has(pid));
  };

  const remainingAfterTerm = await waitForExit();
  if (remainingAfterTerm.length === 0) {
    return;
  }

  await runCommand(["kill", "-KILL", ...remainingAfterTerm]);
  await waitForExit();
}

async function withCleanRuntime<T>(fn: () => Promise<T>): Promise<T> {
  await platform.fs.remove(__testOnlyGetRuntimeStartLockPath(), {
    recursive: true,
  }).catch(() => {});

  const before = await readRuntimeTopologySnapshot();
  const existingPids = uniquePids(before);
  if (existingPids.length > 0) {
    await terminateProcesses(existingPids);
  }

  await platform.fs.remove(__testOnlyGetRuntimeStartLockPath(), {
    recursive: true,
  }).catch(() => {});

  const clearedBefore = await readRuntimeTopologySnapshot();
  assertEquals(
    uniquePids(clearedBefore),
    [],
    `runtime topology smoke could not clear pre-existing HLVM runtime processes:\n${formatSnapshot(clearedBefore)}`,
  );

  try {
    return await fn();
  } finally {
    await terminateProcesses(uniquePids(await readRuntimeTopologySnapshot()));
    await platform.fs.remove(__testOnlyGetRuntimeStartLockPath(), {
      recursive: true,
    }).catch(() => {});
    const after = await readRuntimeTopologySnapshot();
    assertEquals(
      uniquePids(after),
      [],
      `runtime topology smoke cleanup failed:\n${formatSnapshot(after)}`,
    );
  }
}

function assertSuccessfulAsk(result: CommandResult): void {
  assertEquals(
    result.success,
    true,
    `expected compiled ask to succeed:\n${normalizeCliOutput(result.stdout + result.stderr)}`,
  );
  assert(
    normalizeCliOutput(result.stdout).trim().length > 0,
    "expected compiled ask to produce a non-empty reply",
  );
}

function assertSingleSharedRuntime(
  snapshot: RuntimeTopologySnapshot,
): ProcessEntry {
  assertEquals(
    snapshot.repoServe.length,
    1,
    `expected exactly one shared hlvm serve:\n${formatSnapshot(snapshot)}`,
  );
  assertEquals(
    snapshot.sourceServe.length,
    0,
    `expected no source-mode runtime daemon:\n${formatSnapshot(snapshot)}`,
  );
  assertEquals(
    snapshot.bundledServe.length,
    0,
    `expected no bundled GUI runtime daemon:\n${formatSnapshot(snapshot)}`,
  );
  assertEquals(
    snapshot.managedOllama.length,
    1,
    `expected exactly one managed Ollama daemon:\n${formatSnapshot(snapshot)}`,
  );
  assertEquals(
    snapshot.listeners.length,
    2,
    `expected listeners only on 11435 and 11439:\n${formatSnapshot(snapshot)}`,
  );
  assert(
    snapshot.listeners.some((line) => line.includes("127.0.0.1:11435")),
    `expected a runtime listener on 11435:\n${formatSnapshot(snapshot)}`,
  );
  assert(
    snapshot.listeners.some((line) => line.includes("127.0.0.1:11439")),
    `expected a managed Ollama listener on 11439:\n${formatSnapshot(snapshot)}`,
  );
  return snapshot.repoServe[0]!;
}

async function readSha256(path: string): Promise<string> {
  const result = await runCommand(["shasum", "-a", "256", path]);
  assertEquals(result.success, true, result.stderr);
  return result.stdout.trim().split(/\s+/)[0]!;
}

liveTopologyTest(
  "E2E topology: compiled ask cold-starts and reuses exactly one shared daemon while source mode refuses contamination",
  async () => {
    await withCleanRuntime(async () => {
      assert(
        await platform.fs.exists(REPO_BINARY_PATH),
        `missing compiled binary at ${REPO_BINARY_PATH}; build ./hlvm first`,
      );

      const firstAsk = await runCommand([
        REPO_BINARY_PATH,
        "ask",
        "-p",
        "--no-session-persistence",
        "hello",
      ]);
      assertSuccessfulAsk(firstAsk);

      const firstSnapshot = await readRuntimeTopologySnapshot();
      const firstRuntime = assertSingleSharedRuntime(firstSnapshot);

      const secondAsk = await runCommand([
        REPO_BINARY_PATH,
        "ask",
        "-p",
        "--no-session-persistence",
        "hello again",
      ]);
      assertSuccessfulAsk(secondAsk);

      const secondSnapshot = await readRuntimeTopologySnapshot();
      const secondRuntime = assertSingleSharedRuntime(secondSnapshot);
      assertEquals(
        secondRuntime.pid,
        firstRuntime.pid,
        `expected repeated compiled ask to reuse the same shared daemon:\n${formatSnapshot(secondSnapshot)}`,
      );

      const sourceAsk = await runCommand([
        "deno",
        "run",
        "-A",
        SOURCE_CLI_PATH,
        "ask",
        "-p",
        "--no-session-persistence",
        "hello from source mode",
      ]);
      assertEquals(sourceAsk.success, false);
      assertStringIncludes(
        normalizeCliOutput(sourceAsk.stdout + sourceAsk.stderr),
        "Source-mode HLVM will not auto-start or replace the shared runtime without an explicit runtime port.",
      );

      const finalSnapshot = await readRuntimeTopologySnapshot();
      const finalRuntime = assertSingleSharedRuntime(finalSnapshot);
      assertEquals(
        finalRuntime.pid,
        firstRuntime.pid,
        `expected source mode to leave the shared daemon untouched:\n${formatSnapshot(finalSnapshot)}`,
      );
    });
  },
);

liveTopologyTest(
  "E2E topology: rebuilt GUI app attaches to the shared daemon without spawning a bundled runtime",
  async () => {
    if (!GUI_APP_PATH) {
      return;
    }

    await withCleanRuntime(async () => {
      assert(
        await platform.fs.exists(GUI_APP_PATH),
        `missing GUI app at ${GUI_APP_PATH}`,
      );
      assert(
        await platform.fs.exists(GUI_APP_RUNTIME_PATH),
        `missing bundled runtime at ${GUI_APP_RUNTIME_PATH}`,
      );

      const repoSha = await readSha256(REPO_BINARY_PATH);
      const appSha = await readSha256(GUI_APP_RUNTIME_PATH);
      assertEquals(
        appSha,
        repoSha,
        `GUI app bundles a stale hlvm binary:\nrepo=${repoSha}\napp=${appSha}`,
      );

      const firstAsk = await runCommand([
        REPO_BINARY_PATH,
        "ask",
        "-p",
        "--no-session-persistence",
        "hello from gui topology smoke",
      ]);
      assertSuccessfulAsk(firstAsk);

      const beforeOpen = await readRuntimeTopologySnapshot();
      const sharedRuntime = assertSingleSharedRuntime(beforeOpen);

      const opened = await runCommand(["open", GUI_APP_PATH]);
      assertEquals(opened.success, true, opened.stderr);
      await sleep(GUI_LAUNCH_SETTLE_MS);

      const afterOpen = await readRuntimeTopologySnapshot();
      assertSingleSharedRuntime(afterOpen);
      assertEquals(
        afterOpen.guiApp.length >= 1,
        true,
        `expected the GUI app to be running:\n${formatSnapshot(afterOpen)}`,
      );
      assertEquals(
        afterOpen.repoServe[0]?.pid,
        sharedRuntime.pid,
        `expected the GUI app to attach to the existing shared daemon:\n${formatSnapshot(afterOpen)}`,
      );

      await terminateProcesses(afterOpen.guiApp.map((entry) => entry.pid));
      await sleep(GUI_LAUNCH_SETTLE_MS);

      const afterClose = await readRuntimeTopologySnapshot();
      const runtimeAfterClose = assertSingleSharedRuntime(afterClose);
      assertEquals(
        runtimeAfterClose.pid,
        sharedRuntime.pid,
        `expected closing the GUI app to leave the shared daemon alive:\n${formatSnapshot(afterClose)}`,
      );
      assertEquals(
        afterClose.guiApp.length,
        0,
        `expected the GUI app process to exit after close:\n${formatSnapshot(afterClose)}`,
      );
    });
  },
);
