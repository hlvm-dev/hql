/**
 * HTTP Server Integration Tests
 * Tests feature parity between HTTP REPL and terminal REPL
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { startHttpServer } from "../../src/hlvm/cli/repl/http-server.ts";
import { initializeRuntime } from "../../src/common/runtime-initializer.ts";

const TEST_PORT = 11436;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let serverStarted = false;

/**
 * Start server once globally before any tests run
 * Server runs in background for the entire test suite
 */
async function ensureServerRunning() {
  if (serverStarted) return;

  Deno.env.set("HLVM_REPL_PORT", String(TEST_PORT));
  Deno.env.set("HLVM_DISABLE_AI_AUTOSTART", "1"); // Prevent resource leaks

  await initializeRuntime({ ai: true, stdlib: true, cache: true });

  // Start server in background (don't await - it runs forever)
  startHttpServer();

  // Wait for server to be ready
  await new Promise(resolve => setTimeout(resolve, 500));

  // Verify server is responsive
  const health = await fetch(`${BASE_URL}/health`);
  if (!health.ok) {
    throw new Error("Server failed to start");
  }

  serverStarted = true;
}

async function evalCode(code: string): Promise<{
  success: boolean;
  value?: string;
  error?: { name: string; message: string };
}> {
  const response = await fetch(`${BASE_URL}/eval`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });

  return await response.json();
}

Deno.test({
  name: "GET /health returns status",
  async fn() {
    await ensureServerRunning();

    const response = await fetch(`${BASE_URL}/health`);
    const data = await response.json();

    assertEquals(response.status, 200);
    assertEquals(data.status, "ok");
    assertExists(data.initialized);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "POST /eval - arithmetic works",
  async fn() {
    await ensureServerRunning();

    const result = await evalCode("(+ 1 2)");

    assertEquals(result.success, true);
    assertEquals(result.value, "3");
    assertEquals(result.error, null); // API returns null, not undefined
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "POST /eval - AI function exists (ask)",
  async fn() {
    await ensureServerRunning();

    const result = await evalCode("(typeof ask)");

    assertEquals(result.success, true);
    assertEquals(result.value, '"function"');
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "POST /eval - AI function exists (generate)",
  async fn() {
    await ensureServerRunning();

    const result = await evalCode("(typeof generate)");

    assertEquals(result.success, true);
    assertEquals(result.value, '"function"');
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "POST /eval - JS works by default",
  async fn() {
    await ensureServerRunning();

    const result = await evalCode("let x = 10; x * 2");

    assertEquals(result.success, true);
    assertEquals(result.value, "20");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "POST /eval - error handling (syntax error)",
  async fn() {
    await ensureServerRunning();

    const result = await evalCode("(+ 1");

    assertEquals(result.success, false);
    assertExists(result.error);
    assertExists(result.error?.name); // Error name exists
    assertExists(result.error?.message); // Error message exists
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "POST /eval - state persistence (def + use)",
  async fn() {
    await ensureServerRunning();

    // Define a variable
    const defResult = await evalCode("(def testVar 42)");
    assertEquals(defResult.success, true);

    // Use the variable
    const useResult = await evalCode("testVar");
    assertEquals(useResult.success, true);
    assertEquals(useResult.value, "42");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "POST /eval - state persistence (defn + call)",
  async fn() {
    await ensureServerRunning();

    // Define a function
    const defnResult = await evalCode("(defn double [x] (* x 2))");
    assertEquals(defnResult.success, true);

    // Call the function
    const callResult = await evalCode("(double 21)");
    assertEquals(callResult.success, true);
    assertEquals(callResult.value, "42");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
