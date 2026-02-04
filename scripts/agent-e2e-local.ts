// deno run -A scripts/agent-e2e-local.ts [--verbose] [--timeout <ms>]
// Local black-box E2E for HLVM agent CLI (requires local LLM like Ollama).

import { getPlatform } from "../src/platform/platform.ts";
import { log } from "../src/hlvm/api/log.ts";

type TestCase = {
  name: string;
  query: string;
  extraArgs?: string[];
  expect?: {
    mustContain?: string[];
    mustNotContain?: string[];
  };
};

const p = () => getPlatform();
const runCmd = (options: Parameters<ReturnType<typeof p>["command"]["run"]>[0]) =>
  p().command.run(options);
const resolve = (...paths: string[]) => p().path.resolve(...paths);

const args = p().process.args();
let verboseMode = false;
let timeoutMs = 60000;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--verbose") {
    verboseMode = true;
  } else if (arg === "--timeout") {
    const value = Number(args[++i]);
    if (Number.isFinite(value) && value > 0) {
      timeoutMs = value;
    }
  }
}

const cliPath = resolve(p().process.cwd(), "src/hlvm/cli/cli.ts");
const commonArgs = ["ask"];

const tests: TestCase[] = [
  {
    name: "L0 list_files",
    query: "list files in src/hlvm/agent",
    expect: {
      mustContain: ["Found", "src/hlvm/agent"],
    },
  },
  {
    name: "L0 search_code",
    query: "search for \"runReActLoop\" in src/hlvm/agent",
    expect: {
      mustContain: ["runReActLoop"],
    },
  },
  {
    name: "L0 find_symbol",
    query: "find symbol ContextManager in src/hlvm/agent",
    expect: {
      mustContain: ["ContextManager"],
    },
  },
  {
    name: "L0 get_structure",
    query: "show structure of src/hlvm/agent/security",
    expect: {
      mustContain: ["security"],
    },
  },
  {
    name: "Path sandbox rejection",
    query: "read file /etc/passwd",
    expect: {
      mustContain: ["unable", "outside"],
    },
  },
  {
    name: "Verbose mode (optional)",
    query: "list files in src/hlvm/agent/tools",
    extraArgs: verboseMode ? ["--verbose"] : undefined,
    expect: verboseMode ? { mustContain: ["[TRACE] Tool call"] } : undefined,
  },
  {
    name: "Tool error propagation",
    query: "read missing file ./nope.txt",
    expect: {
      mustContain: ["Error", "nope.txt"],
    },
  },
];

async function readStream(stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
  if (!stream) return "";
  return await new Response(stream).text();
}

async function runTest(test: TestCase): Promise<boolean> {
  const extraArgs = test.extraArgs ?? [];
  const cmd = [
    "deno",
    "run",
    "--allow-all",
    cliPath,
    ...commonArgs,
    ...extraArgs,
    test.query,
  ];

  const proc = runCmd({
    cmd,
    stdout: "piped",
    stderr: "piped",
  });

  const timer = setTimeout(() => {
    if (proc.kill) {
      proc.kill("SIGTERM");
    }
  }, timeoutMs);

  const [status, stdout, stderr] = await Promise.all([
    proc.status,
    readStream(proc.stdout as ReadableStream<Uint8Array> | null),
    readStream(proc.stderr as ReadableStream<Uint8Array> | null),
  ]);
  clearTimeout(timer);

  const output = `${stdout}\n${stderr}`.trim();
  if (output.includes("HQL5002") || output.includes("Operation not permitted")) {
    log.raw.log(`SKIP ${test.name} (LLM unavailable or blocked)`);
    log.raw.log(output);
    return false;
  }

  const mustContain = test.expect?.mustContain ?? [];
  const mustNotContain = test.expect?.mustNotContain ?? [];

  for (const needle of mustContain) {
    if (!output.includes(needle)) {
      log.error(`FAIL ${test.name} - missing "${needle}"`);
      log.raw.log(output);
      return false;
    }
  }
  for (const needle of mustNotContain) {
    if (output.includes(needle)) {
      log.error(`FAIL ${test.name} - found forbidden "${needle}"`);
      log.raw.log(output);
      return false;
    }
  }

  log.raw.log(`OK  ${test.name}`);
  return status.success;
}

let passed = 0;
let failed = 0;

log.raw.log("=== HLVM Agent CLI E2E (Local) ===");
log.raw.log(`Verbose=${verboseMode} | timeout=${timeoutMs}ms`);

for (const test of tests) {
  const ok = await runTest(test);
  if (ok) passed++; else failed++;
}

log.raw.log(`\nResults: ${passed}/${passed + failed} passed`);
if (failed > 0) {
  p().process.exit(1);
}
