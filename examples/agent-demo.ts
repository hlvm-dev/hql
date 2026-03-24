/**
 * Agent Demo Script
 *
 * Simple demonstration of the AI agent system working end-to-end.
 *
 * Usage:
 *   deno run --allow-all examples/agent-demo.ts
 *
 * Requirements:
 *   - Ollama running with a model pulled (e.g., llama3.2:1b)
 *   - Or set ANTHROPIC_API_KEY for Anthropic Claude
 */

import { ContextManager } from "../src/hlvm/agent/context.ts";
import { runReActLoop } from "../src/hlvm/agent/orchestrator.ts";
import { generateSystemPrompt } from "../src/hlvm/agent/llm-integration.ts";
import { getAgentEngine } from "../src/hlvm/agent/engine.ts";

// ============================================================
// Configuration
// ============================================================

const WORKSPACE = Deno.cwd();
const MODEL = "ollama/llama3.2:3b"; // Available model for demo

// Simple tasks that should work reliably
const DEMO_TASKS = [
  "List all TypeScript files in the src/hlvm/agent directory",
  "Count how many test files exist in tests/unit/agent",
  "Search for the word 'orchestrator' in src/hlvm/agent files",
];

// ============================================================
// Demo Runner
// ============================================================

async function runDemo(task: string) {
  console.log("\n" + "=".repeat(70));
  console.log(`TASK: ${task}`);
  console.log("=".repeat(70) + "\n");

  // Create context with system prompt
  const context = new ContextManager({
    maxTokens: 8000, // Smaller budget for demo
  });

  context.addMessage({
    role: "system",
    content: generateSystemPrompt(),
  });

  // Create LLM function
  const llm = getAgentEngine().createLLM({ model: MODEL });

  try {
    // Run agent
    const startTime = Date.now();
    const result = await runReActLoop(
      task,
      {
        workspace: WORKSPACE,
        context,
        permissionMode: "bypassPermissions", // Skip all prompts for demo
        maxToolCalls: 5, // Limit tool calls for demo
      },
      llm,
    );

    const duration = Date.now() - startTime;

    // Display result
    console.log("\n" + "-".repeat(70));
    console.log("RESULT:");
    console.log("-".repeat(70));
    console.log(result);
    console.log("\n" + "-".repeat(70));
    console.log(`Completed in ${(duration / 1000).toFixed(2)}s`);
    console.log("-".repeat(70));

    // Show context stats
    const stats = context.getStats();
    console.log("\nContext Stats:");
    console.log(`  Messages: ${stats.messageCount}`);
    console.log(`  Estimated tokens: ${stats.estimatedTokens}`);
    console.log(`  Tool calls: ${stats.toolMessages}`);

    return true;
  } catch (error) {
    console.error("\n❌ ERROR:", error instanceof Error ? error.message : error);
    return false;
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log("\n🤖 HLVM AI Agent Demo");
  console.log("=".repeat(70));
  console.log(`Model: ${MODEL}`);
  console.log(`Workspace: ${WORKSPACE}`);
  console.log("=".repeat(70));

  // Check if we can run (requires LLM provider)
  try {
    const { ai } = await import("../src/hlvm/api/ai.ts");
    const status = await ai.status();

    if (!status.available) {
      console.error("\n❌ Error: No AI provider available");
      console.error("   " + (status.error || "Unknown error"));
      console.error("\nPlease ensure:");
      console.error("  - Ollama is running: ollama serve");
      console.error("  - A model is pulled: ollama pull llama3.2:1b");
      console.error("  - Or set ANTHROPIC_API_KEY for Claude");
      Deno.exit(1);
    }

    console.log("✅ AI provider available\n");
  } catch (error) {
    console.error("❌ Failed to check AI status:", error);
    Deno.exit(1);
  }

  // Run demos
  let successCount = 0;
  for (const task of DEMO_TASKS) {
    const success = await runDemo(task);
    if (success) successCount++;

    // Wait between demos
    if (DEMO_TASKS.indexOf(task) < DEMO_TASKS.length - 1) {
      console.log("\n⏳ Waiting 2s before next demo...\n");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("DEMO COMPLETE");
  console.log("=".repeat(70));
  console.log(`Completed: ${successCount}/${DEMO_TASKS.length} tasks`);
  console.log("=".repeat(70) + "\n");
}

// Run if called directly
if (import.meta.main) {
  await main();
}
