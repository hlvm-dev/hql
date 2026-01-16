#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write
/**
 * Ollama Models Test Suite
 *
 * Tests Ollama models to verify they work correctly with the HLVM HQL runtime.
 *
 * Usage:
 *   deno run --allow-net --allow-read scripts/test-ollama-models.ts [options]
 *
 * Options:
 *   --installed     Test only installed models (default)
 *   --sample        Test 1 model from each category (pulls if needed)
 *   --model <name>  Test a specific model
 *   --pull          Pull missing models before testing
 *   --verbose       Show full responses
 *   --json          Output results as JSON
 *   --timeout <ms>  Timeout per model (default: 30000)
 */

interface OllamaModel {
  name: string;
  model: string;
  size: number;
  digest: string;
  modified_at: string;
}

interface ScrapedModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  model_type?: string;
  variants: Array<{
    id: string;
    name: string;
    parameters: string;
    size: string;
    context: string;
  }>;
}

interface TestResult {
  model: string;
  status: "pass" | "fail" | "skip" | "timeout";
  responseTime?: number;
  firstTokenTime?: number;
  response?: string;
  error?: string;
  isVision?: boolean;
  isEmbedding?: boolean;
}

// ANSI colors
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

const OLLAMA_API = "http://localhost:11434";

async function getInstalledModels(): Promise<string[]> {
  try {
    const resp = await fetch(`${OLLAMA_API}/api/tags`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return (data.models || []).map((m: OllamaModel) => m.name);
  } catch {
    console.error(
      `${colors.red}Error: Cannot connect to Ollama at ${OLLAMA_API}${colors.reset}`,
    );
    console.error(`Make sure Ollama is running: ${colors.cyan}ollama serve${colors.reset}`);
    Deno.exit(1);
  }
}

async function loadScrapedModels(): Promise<ScrapedModel[]> {
  try {
    const path = new URL("../src/data/ollama_models.json", import.meta.url);
    const data = JSON.parse(await Deno.readTextFile(path));
    return data.models || [];
  } catch {
    // Try alternate path
    try {
      const data = JSON.parse(
        await Deno.readTextFile("src/data/ollama_models.json"),
      );
      return data.models || [];
    } catch {
      return [];
    }
  }
}

async function pullModel(model: string): Promise<boolean> {
  console.log(`${colors.blue}Pulling ${model}...${colors.reset}`);
  try {
    const resp = await fetch(`${OLLAMA_API}/api/pull`, {
      method: "POST",
      body: JSON.stringify({ name: model, stream: false }),
    });
    if (!resp.ok) {
      console.error(`${colors.red}Failed to pull ${model}: HTTP ${resp.status}${colors.reset}`);
      return false;
    }
    // Wait for pull to complete
    await resp.json();
    console.log(`${colors.green}✓ Pulled ${model}${colors.reset}`);
    return true;
  } catch (err) {
    console.error(`${colors.red}Failed to pull ${model}: ${err}${colors.reset}`);
    return false;
  }
}

async function testModel(
  model: string,
  options: { timeout: number; verbose: boolean; isVision?: boolean; isEmbedding?: boolean },
): Promise<TestResult> {
  const { timeout, verbose, isVision, isEmbedding } = options;

  // For embedding models, test the embedding endpoint
  if (isEmbedding) {
    return testEmbeddingModel(model, timeout, verbose);
  }

  const start = Date.now();
  let firstTokenTime: number | undefined;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Test streaming mode
    const resp = await fetch(`${OLLAMA_API}/api/generate`, {
      method: "POST",
      body: JSON.stringify({
        model,
        prompt: 'Reply with exactly "OK" and nothing else.',
        stream: true,
        options: { num_predict: 20 }, // Limit tokens for speed
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      return { model, status: "fail", error: `HTTP ${resp.status}`, isVision, isEmbedding };
    }

    // Read streaming response
    let fullResponse = "";
    const reader = resp.body?.getReader();
    if (!reader) {
      return { model, status: "fail", error: "No response body", isVision, isEmbedding };
    }

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      for (const line of chunk.split("\n").filter((l) => l.trim())) {
        try {
          const data = JSON.parse(line);
          if (data.response) {
            if (!firstTokenTime) {
              firstTokenTime = Date.now() - start;
            }
            fullResponse += data.response;
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    const responseTime = Date.now() - start;

    if (fullResponse.trim()) {
      return {
        model,
        status: "pass",
        responseTime,
        firstTokenTime,
        response: verbose ? fullResponse.trim() : undefined,
        isVision,
        isEmbedding,
      };
    } else {
      return { model, status: "fail", error: "Empty response", isVision, isEmbedding };
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { model, status: "timeout", error: `Timeout after ${timeout}ms`, isVision, isEmbedding };
    }
    return { model, status: "fail", error: String(err), isVision, isEmbedding };
  }
}

async function testEmbeddingModel(
  model: string,
  timeout: number,
  verbose: boolean,
): Promise<TestResult> {
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const resp = await fetch(`${OLLAMA_API}/api/embeddings`, {
      method: "POST",
      body: JSON.stringify({
        model,
        prompt: "Hello world",
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      return { model, status: "fail", error: `HTTP ${resp.status}`, isEmbedding: true };
    }

    const data = await resp.json();
    const responseTime = Date.now() - start;

    if (data.embedding && Array.isArray(data.embedding) && data.embedding.length > 0) {
      return {
        model,
        status: "pass",
        responseTime,
        response: verbose ? `[${data.embedding.length} dimensions]` : undefined,
        isEmbedding: true,
      };
    } else {
      return { model, status: "fail", error: "Invalid embedding response", isEmbedding: true };
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { model, status: "timeout", error: `Timeout after ${timeout}ms`, isEmbedding: true };
    }
    return { model, status: "fail", error: String(err), isEmbedding: true };
  }
}

function printResult(result: TestResult, index: number, total: number): void {
  const prefix = `[${String(index + 1).padStart(String(total).length)}/${total}]`;
  const icon =
    result.status === "pass"
      ? `${colors.green}✓${colors.reset}`
      : result.status === "timeout"
        ? `${colors.yellow}⏱${colors.reset}`
        : `${colors.red}✗${colors.reset}`;

  const typeTag = result.isEmbedding
    ? `${colors.cyan}[embed]${colors.reset} `
    : result.isVision
      ? `${colors.blue}[vision]${colors.reset} `
      : "";

  const time = result.responseTime
    ? `${colors.dim}(${result.responseTime}ms${result.firstTokenTime ? `, TTFT: ${result.firstTokenTime}ms` : ""})${colors.reset}`
    : "";

  const response = result.response ? ` → ${colors.dim}"${result.response}"${colors.reset}` : "";
  const error = result.error ? ` ${colors.red}${result.error}${colors.reset}` : "";

  console.log(`${prefix} ${icon} ${typeTag}${result.model} ${time}${response}${error}`);
}

function printSummary(results: TestResult[]): void {
  const passed = results.filter((r) => r.status === "pass");
  const failed = results.filter((r) => r.status === "fail");
  const timeouts = results.filter((r) => r.status === "timeout");
  const skipped = results.filter((r) => r.status === "skip");

  console.log("\n" + "=".repeat(60));
  console.log(`${colors.bold}TEST SUMMARY${colors.reset}`);
  console.log("=".repeat(60));

  console.log(`${colors.green}Passed:   ${passed.length}${colors.reset}`);
  if (failed.length > 0) {
    console.log(`${colors.red}Failed:   ${failed.length}${colors.reset}`);
  }
  if (timeouts.length > 0) {
    console.log(`${colors.yellow}Timeout:  ${timeouts.length}${colors.reset}`);
  }
  if (skipped.length > 0) {
    console.log(`${colors.dim}Skipped:  ${skipped.length}${colors.reset}`);
  }
  console.log(`Total:    ${results.length}`);

  if (passed.length > 0) {
    const avgTime = Math.round(
      passed.reduce((sum, r) => sum + (r.responseTime || 0), 0) / passed.length,
    );
    const avgTTFT = passed.filter((r) => r.firstTokenTime).length > 0
      ? Math.round(
          passed.reduce((sum, r) => sum + (r.firstTokenTime || 0), 0) /
            passed.filter((r) => r.firstTokenTime).length,
        )
      : null;

    console.log(`\nAvg response time: ${avgTime}ms`);
    if (avgTTFT) {
      console.log(`Avg time to first token: ${avgTTFT}ms`);
    }
  }

  if (failed.length > 0) {
    console.log(`\n${colors.red}Failed models:${colors.reset}`);
    for (const r of failed) {
      console.log(`  - ${r.model}: ${r.error}`);
    }
  }
}

function parseArgs(): {
  mode: "installed" | "sample" | "model";
  model?: string;
  pull: boolean;
  verbose: boolean;
  json: boolean;
  timeout: number;
} {
  const args = Deno.args;
  const result = {
    mode: "installed" as "installed" | "sample" | "model",
    model: undefined as string | undefined,
    pull: false,
    verbose: false,
    json: false,
    timeout: 30000,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--installed":
        result.mode = "installed";
        break;
      case "--sample":
        result.mode = "sample";
        break;
      case "--model":
        result.mode = "model";
        result.model = args[++i];
        break;
      case "--pull":
        result.pull = true;
        break;
      case "--verbose":
        result.verbose = true;
        break;
      case "--json":
        result.json = true;
        break;
      case "--timeout":
        result.timeout = parseInt(args[++i]) || 30000;
        break;
      case "--help":
      case "-h":
        console.log(`
${colors.bold}Ollama Models Test Suite${colors.reset}

Tests Ollama models to verify they work correctly with the HLVM HQL runtime.

${colors.bold}Usage:${colors.reset}
  deno run --allow-net --allow-read scripts/test-ollama-models.ts [options]

${colors.bold}Options:${colors.reset}
  --installed       Test only installed models (default)
  --sample          Test 1 model from each category (regular, vision, embedding)
  --model <name>    Test a specific model
  --pull            Pull missing models before testing
  --verbose         Show full responses
  --json            Output results as JSON
  --timeout <ms>    Timeout per model (default: 30000)
  --help, -h        Show this help

${colors.bold}Examples:${colors.reset}
  # Test all installed models
  deno run --allow-net --allow-read scripts/test-ollama-models.ts

  # Test a specific model (pulls if needed)
  deno run --allow-net --allow-read scripts/test-ollama-models.ts --model llama3.2:3b --pull

  # Sample test from each category
  deno run --allow-net --allow-read scripts/test-ollama-models.ts --sample --pull

  # Verbose output with longer timeout
  deno run --allow-net --allow-read scripts/test-ollama-models.ts --verbose --timeout 60000
`);
        Deno.exit(0);
    }
  }

  return result;
}

async function main() {
  const args = parseArgs();

  console.log(`${colors.bold}Ollama Models Test Suite${colors.reset}\n`);

  // Check Ollama is running
  const installed = await getInstalledModels();
  console.log(`${colors.green}✓${colors.reset} Ollama is running at ${OLLAMA_API}`);
  console.log(`${colors.dim}Found ${installed.length} installed models${colors.reset}\n`);

  // Load scraped models for metadata
  const scrapedModels = await loadScrapedModels();
  const scrapedMap = new Map<string, ScrapedModel>();
  for (const m of scrapedModels) {
    scrapedMap.set(m.id, m);
    for (const v of m.variants) {
      scrapedMap.set(`${m.id}:${v.name}`, m);
    }
  }

  let modelsToTest: string[] = [];

  if (args.mode === "model" && args.model) {
    modelsToTest = [args.model];
  } else if (args.mode === "sample") {
    // Pick 1 regular, 1 vision, 1 embedding from scraped models
    const regular = scrapedModels.find((m) => !m.vision && m.model_type !== "embedding");
    const vision = scrapedModels.find((m) => m.vision);
    const embedding = scrapedModels.find((m) => m.model_type === "embedding");

    if (regular) modelsToTest.push(`${regular.id}:${regular.variants[0]?.name || "latest"}`);
    if (vision) modelsToTest.push(`${vision.id}:${vision.variants[0]?.name || "latest"}`);
    if (embedding) modelsToTest.push(`${embedding.id}:${embedding.variants[0]?.name || "latest"}`);

    console.log(`Sample models to test:`);
    for (const m of modelsToTest) {
      console.log(`  - ${m}`);
    }
    console.log();
  } else {
    modelsToTest = installed;
  }

  // Check which models need to be pulled
  if (args.pull) {
    const missing = modelsToTest.filter((m) => !installed.includes(m));
    for (const m of missing) {
      await pullModel(m);
    }
    // Refresh installed list
    const refreshed = await getInstalledModels();
    modelsToTest = modelsToTest.filter((m) => refreshed.includes(m));
  } else {
    const missing = modelsToTest.filter((m) => !installed.includes(m));
    if (missing.length > 0) {
      console.log(
        `${colors.yellow}Warning: ${missing.length} models not installed. Use --pull to install.${colors.reset}`,
      );
      for (const m of missing) {
        console.log(`  - ${m}`);
      }
      console.log();
      modelsToTest = modelsToTest.filter((m) => installed.includes(m));
    }
  }

  if (modelsToTest.length === 0) {
    console.log(`${colors.yellow}No models to test.${colors.reset}`);
    Deno.exit(0);
  }

  console.log(`${colors.bold}Testing ${modelsToTest.length} models...${colors.reset}\n`);

  const results: TestResult[] = [];

  for (let i = 0; i < modelsToTest.length; i++) {
    const model = modelsToTest[i];
    const baseModel = model.split(":")[0];
    const scraped = scrapedMap.get(model) || scrapedMap.get(baseModel);
    const isVision = scraped?.vision ?? false;
    const isEmbedding = scraped?.model_type === "embedding";

    const result = await testModel(model, {
      timeout: args.timeout,
      verbose: args.verbose,
      isVision,
      isEmbedding,
    });

    results.push(result);
    printResult(result, i, modelsToTest.length);
  }

  if (args.json) {
    console.log("\n" + JSON.stringify(results, null, 2));
  } else {
    printSummary(results);
  }

  // Exit with error code if any tests failed
  const failedCount = results.filter((r) => r.status === "fail" || r.status === "timeout").length;
  Deno.exit(failedCount > 0 ? 1 : 0);
}

main();
