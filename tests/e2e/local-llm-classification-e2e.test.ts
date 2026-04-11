/**
 * Local LLM Classification E2E Tests — Real local model calls.
 *
 * Tests only the retained semantic classifiers.
 * Requires the local fallback model to be available on the embedded Ollama port.
 */

import { assertEquals } from "jsr:@std/assert@1";
import {
  classifyBrowserAutomation,
  classifyTask,
} from "../../src/hlvm/runtime/local-llm.ts";
import { LOCAL_FALLBACK_MODEL_ID } from "../../src/hlvm/runtime/local-fallback.ts";
import { buildTaskProfile } from "../../src/hlvm/agent/auto-select.ts";

const OLLAMA_PORT = 11439;
const modelName = LOCAL_FALLBACK_MODEL_ID.split("/").pop() ?? "";
let localModelAvailable = false;
try {
  const res = await fetch(`http://localhost:${OLLAMA_PORT}/api/tags`);
  if (res.ok) {
    const data = await res.json();
    localModelAvailable = data.models?.some((m: { name: string }) =>
      m.name === modelName || m.name.startsWith(modelName)
    );
  }
} catch {
  // Local model unavailable.
}

function e2e(name: string, fn: () => Promise<void>) {
  Deno.test({
    name: `[E2E] local-llm: ${name}`,
    ignore: !localModelAvailable,
    sanitizeOps: false,
    sanitizeResources: false,
    fn,
  });
}

e2e("classifyTask: code query is code", async () => {
  const result = await classifyTask("write a fibonacci function in Python");
  assertEquals(result.isCodeTask, true);
});

e2e("classifyTask: reasoning query is reasoning", async () => {
  const result = await classifyTask(
    "compare the pros and cons of React vs Vue for a large enterprise app",
  );
  assertEquals(result.isReasoningTask, true);
});

e2e("classifyTask: JSON query needs structured output", async () => {
  const result = await classifyTask(
    "list the top 5 programming languages and output as JSON",
  );
  assertEquals(result.needsStructuredOutput, true);
});

e2e("classifyBrowserAutomation: installer download request is browser automation", async () => {
  const result = await classifyBrowserAutomation(
    "download the Python installer",
  );
  assertEquals(result.isBrowserTask, true);
});

e2e("buildTaskProfile: casual chat has no special flags", async () => {
  const profile = await buildTaskProfile("hello, how are you today?");
  assertEquals(profile.isCodeTask, false);
  assertEquals(profile.isReasoningTask, false);
  assertEquals(profile.needsStructuredOutput, false);
});
