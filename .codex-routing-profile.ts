import { performance } from "node:perf_hooks";

import { computeRoutingResult } from "./src/hlvm/agent/request-routing.ts";
import { getPlatform } from "./src/platform/platform.ts";
import { runAgentQuery } from "./src/hlvm/agent/agent-runner.ts";
import type { AgentUIEvent } from "./src/hlvm/agent/orchestrator.ts";
import { startBrowserFixtureServer } from "./tests/shared/browser-fixture-server.ts";

type RoutingLabel = {
  browser: boolean;
  delegate: boolean;
  plan: boolean;
};

type RoutingCase = {
  id: string;
  query: string;
  expected: RoutingLabel;
};

type AgentCase = {
  id: string;
  query: string;
  fixtures?: Record<string, string>;
  toolAllowlist?: string[];
};

const platform = getPlatform();

const ROUTING_CASES: RoutingCase[] = [
  {
    id: "simple_code_fix",
    query: "Fix the bug in src/auth.ts where login fails for empty usernames.",
    expected: { browser: false, delegate: false, plan: false },
  },
  {
    id: "read_single_file",
    query: "Read notes.txt and summarize it.",
    expected: { browser: false, delegate: false, plan: false },
  },
  {
    id: "explicit_plan_then",
    query:
      "First inspect the current auth flow, then patch the bug, then verify with tests.",
    expected: { browser: false, delegate: false, plan: true },
  },
  {
    id: "explicit_plan_stepwise",
    query: "Create a step-by-step plan before doing anything else.",
    expected: { browser: false, delegate: false, plan: true },
  },
  {
    id: "parallel_explicit",
    query:
      "Review these files in parallel: src/a.ts src/b.ts src/c.ts and summarize the issues.",
    expected: { browser: false, delegate: true, plan: false },
  },
  {
    id: "batch_each_file",
    query: "Process each file in the docs directory and extract the title.",
    expected: { browser: false, delegate: true, plan: false },
  },
  {
    id: "browser_url",
    query: "Open https://example.com and tell me the page title.",
    expected: { browser: true, delegate: false, plan: false },
  },
  {
    id: "browser_domain",
    query: "Go to github.com and tell me the title of the homepage.",
    expected: { browser: true, delegate: false, plan: false },
  },
  {
    id: "browser_tool_name",
    query: "Use pw_goto on https://example.com and then read the page text.",
    expected: { browser: true, delegate: false, plan: false },
  },
  {
    id: "browser_implicit_form",
    query: "Use the website to fill out the form and submit it.",
    expected: { browser: true, delegate: false, plan: false },
  },
  {
    id: "browser_implicit_download",
    query: "Browse the release page and download the macOS installer.",
    expected: { browser: true, delegate: false, plan: false },
  },
  {
    id: "browser_implicit_multi_page",
    query: "Look through several web pages and summarize the differences.",
    expected: { browser: true, delegate: false, plan: false },
  },
  {
    id: "delegate_multiple_agents",
    query:
      "Split this into subtasks for multiple agents and then combine the results.",
    expected: { browser: false, delegate: true, plan: false },
  },
  {
    id: "delegate_fanout_wording",
    query: "Fan this work out across components and review each independently.",
    expected: { browser: false, delegate: true, plan: false },
  },
  {
    id: "plan_in_stages",
    query:
      "Handle this in stages: investigate root cause, patch it, and confirm with tests.",
    expected: { browser: false, delegate: false, plan: true },
  },
  {
    id: "plain_question",
    query: "What is the capital of Japan?",
    expected: { browser: false, delegate: false, plan: false },
  },
  {
    id: "structured_output_only",
    query: "Answer in a JSON object with name and version.",
    expected: { browser: false, delegate: false, plan: false },
  },
  {
    id: "multi_file_no_parallel",
    query:
      "Compare src/auth.ts and src/login.ts and explain the differences.",
    expected: { browser: false, delegate: false, plan: false },
  },
];

const AGENT_CASES: AgentCase[] = [
  {
    id: "knowledge",
    query: "What is the capital of Japan?",
    toolAllowlist: ["read_file", "list_files", "search_web", "shell_exec", "ask_user"],
  },
  {
    id: "read_note",
    query: "Read todo.txt and summarize it.",
    fixtures: {
      "todo.txt":
        "1. Buy groceries\n2. Call dentist\n3. Finish report\n4. Water plants\n",
    },
    toolAllowlist: ["read_file", "list_files", "shell_exec", "ask_user"],
  },
];

type AgentSummary = {
  model: string;
  caseId: string;
  elapsedMs: number;
  textLength: number;
  toolNames: string[];
  success: boolean;
  error?: string;
};

function summarizeTools(events: AgentUIEvent[]): string[] {
  return events
    .filter((event): event is Extract<AgentUIEvent, { type: "tool_end" }> =>
      event.type === "tool_end" && event.success
    )
    .map((event) => event.name);
}

async function runRoutingBenchmark() {
  const rows: Array<{
    id: string;
    expected: RoutingLabel;
    standard: RoutingLabel;
    structural: RoutingLabel;
    standardMs: number;
    structuralMs: number;
  }> = [];

  for (const testCase of ROUTING_CASES) {
    const startStandard = performance.now();
    const standard = await computeRoutingResult({
      query: testCase.query,
      tier: "standard",
    });
    const standardMs = performance.now() - startStandard;

    const startStructural = performance.now();
    const structural = await computeRoutingResult({
      query: testCase.query,
      tier: "enhanced",
    });
    const structuralMs = performance.now() - startStructural;

    rows.push({
      id: testCase.id,
      expected: testCase.expected,
      standard: {
        browser: standard.taskDomain === "browser",
        delegate: standard.shouldDelegate,
        plan: standard.needsPlan,
      },
      structural: {
        browser: structural.taskDomain === "browser",
        delegate: structural.shouldDelegate,
        plan: structural.needsPlan,
      },
      standardMs,
      structuralMs,
    });
  }

  const score = (actual: RoutingLabel, expected: RoutingLabel) =>
    Number(actual.browser === expected.browser) +
    Number(actual.delegate === expected.delegate) +
    Number(actual.plan === expected.plan);

  const standardPoints = rows.reduce((sum, row) =>
    sum + score(row.standard, row.expected), 0);
  const structuralPoints = rows.reduce((sum, row) =>
    sum + score(row.structural, row.expected), 0);
  const totalPoints = rows.length * 3;

  const disagreements = rows.filter((row) =>
    row.standard.browser !== row.structural.browser ||
    row.standard.delegate !== row.structural.delegate ||
    row.standard.plan !== row.structural.plan
  );

  const classifyAllWins = disagreements.filter((row) =>
    score(row.standard, row.expected) > score(row.structural, row.expected)
  );
  const structuralWins = disagreements.filter((row) =>
    score(row.structural, row.expected) > score(row.standard, row.expected)
  );

  const mean = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    rows,
    summary: {
      caseCount: rows.length,
      standardAccuracy: standardPoints / totalPoints,
      structuralAccuracy: structuralPoints / totalPoints,
      meanStandardMs: mean(rows.map((row) => row.standardMs)),
      meanStructuralMs: mean(rows.map((row) => row.structuralMs)),
      disagreements: disagreements.length,
      classifyAllWins: classifyAllWins.map((row) => row.id),
      structuralWins: structuralWins.map((row) => row.id),
    },
  };
}

async function withWorkspace<T>(
  fixtures: Record<string, string> | undefined,
  fn: (workspace: string) => Promise<T>,
): Promise<T> {
  const workspace = await platform.fs.makeTempDir({
    prefix: "hlvm-routing-profile-",
  });
  try {
    for (const [relativePath, content] of Object.entries(fixtures ?? {})) {
      const fullPath = platform.path.join(workspace, relativePath);
      await platform.fs.mkdir(platform.path.dirname(fullPath), {
        recursive: true,
      });
      await platform.fs.writeTextFile(fullPath, content);
    }
    return await fn(workspace);
  } finally {
    try {
      await platform.fs.remove(workspace, { recursive: true });
    } catch {
      // best effort cleanup
    }
  }
}

async function runAgentCase(
  model: string,
  testCase: AgentCase,
): Promise<AgentSummary> {
  return await withWorkspace(testCase.fixtures, async (workspace) => {
    const events: AgentUIEvent[] = [];
    const start = performance.now();
    try {
      const result = await runAgentQuery({
        query: testCase.query,
        model,
        workspace,
        permissionMode: "bypassPermissions",
        toolAllowlist: testCase.toolAllowlist,
        disablePersistentMemory: true,
        skipSessionHistory: true,
        callbacks: {
          onAgentEvent: (event) => events.push(event),
        },
      });
      return {
        model,
        caseId: testCase.id,
        elapsedMs: performance.now() - start,
        textLength: result.text.trim().length,
        toolNames: summarizeTools(events),
        success: true,
      };
    } catch (error) {
      return {
        model,
        caseId: testCase.id,
        elapsedMs: performance.now() - start,
        textLength: 0,
        toolNames: summarizeTools(events),
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

async function runBrowserCase(model: string): Promise<AgentSummary> {
  const browserFixture = startBrowserFixtureServer();
  try {
    return await withWorkspace(undefined, async (workspace) => {
      const events: AgentUIEvent[] = [];
      const query =
        `Go to ${browserFixture.baseUrl}/form, fill the name as Alice Smith and the email as alice@test.com, click Register, and report the confirmed name and email.`;
      const start = performance.now();
      try {
        const result = await runAgentQuery({
          query,
          model,
          workspace,
          permissionMode: "bypassPermissions",
          disablePersistentMemory: true,
          skipSessionHistory: true,
          callbacks: {
            onAgentEvent: (event) => events.push(event),
          },
        });
        return {
          model,
          caseId: "browser_form",
          elapsedMs: performance.now() - start,
          textLength: result.text.trim().length,
          toolNames: summarizeTools(events),
          success: true,
        };
      } catch (error) {
        return {
          model,
          caseId: "browser_form",
          elapsedMs: performance.now() - start,
          textLength: 0,
          toolNames: summarizeTools(events),
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  } finally {
    await browserFixture.server.shutdown();
  }
}

async function main() {
  const routing = await runRoutingBenchmark();
  const liveModels = [
    "ollama/gemma4:e2b",
    "claude-code/claude-haiku-4-5-20251001",
  ];

  const agentResults: AgentSummary[] = [];
  for (const model of liveModels) {
    for (const testCase of AGENT_CASES) {
      agentResults.push(await runAgentCase(model, testCase));
    }
    agentResults.push(await runBrowserCase(model));
  }

  console.log(JSON.stringify({ routing, agentResults }, null, 2));
}

await main();
