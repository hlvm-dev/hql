/**
 * Context Manager Tests
 *
 * Verifies context management and token budget functionality
 */

import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  ContextManager,
  ContextOverflowError,
} from "../../../src/hlvm/agent/context.ts";
import { DEFAULT_CONTEXT_CONFIG } from "../../../src/hlvm/agent/constants.ts";

// ============================================================
// Basic Message Management tests
// ============================================================

Deno.test({
  name: "Context: addMessage - add single message",
  fn() {
    const context = new ContextManager();

    context.addMessage({
      role: "user",
      content: "Hello",
    });

    const messages = context.getMessages();
    assertEquals(messages.length, 1);
    assertEquals(messages[0].role, "user");
    assertEquals(messages[0].content, "Hello");
  },
});

Deno.test({
  name: "Context: addMessage - add timestamp automatically",
  fn() {
    const context = new ContextManager();

    context.addMessage({
      role: "user",
      content: "Hello",
    });

    const messages = context.getMessages();
    assertEquals(typeof messages[0].timestamp, "number");
    assertEquals(messages[0].timestamp! > 0, true);
  },
});

Deno.test({
  name: "Context: addMessage - preserve explicit timestamp",
  fn() {
    const context = new ContextManager();
    const explicitTimestamp = 1234567890;

    context.addMessage({
      role: "user",
      content: "Hello",
      timestamp: explicitTimestamp,
    });

    const messages = context.getMessages();
    assertEquals(messages[0].timestamp, explicitTimestamp);
  },
});

Deno.test({
  name: "Context: addMessages - add multiple messages",
  fn() {
    const context = new ContextManager();

    context.addMessages([
      { role: "system", content: "System prompt" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ]);

    const messages = context.getMessages();
    assertEquals(messages.length, 3);
  },
});

Deno.test({
  name: "Context: getMessages - returns internal array (no copy)",
  fn() {
    const context = new ContextManager();

    context.addMessage({ role: "user", content: "Hello" });

    const messages1 = context.getMessages();
    const messages2 = context.getMessages();

    // Fix 21: Same object (no copy for performance)
    assertEquals(messages1 === messages2, true);

    // Same content
    assertEquals(messages1.length, messages2.length);
  },
});

Deno.test({
  name: "Context: getMessagesCopy - returns a separate copy",
  fn() {
    const context = new ContextManager();

    context.addMessage({ role: "user", content: "Hello" });

    const messages1 = context.getMessagesCopy();
    const messages2 = context.getMessagesCopy();

    // Different objects
    assertEquals(messages1 !== messages2, true);

    // Same content
    assertEquals(messages1.length, messages2.length);
  },
});

Deno.test({
  name: "Context: clear - remove all messages",
  fn() {
    const context = new ContextManager();

    context.addMessages([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ]);

    assertEquals(context.getMessages().length, 2);

    context.clear();

    assertEquals(context.getMessages().length, 0);
  },
});

// ============================================================
// Query tests
// ============================================================

Deno.test({
  name: "Context: getMessagesByRole - filter by role",
  fn() {
    const context = new ContextManager();

    context.addMessages([
      { role: "system", content: "System" },
      { role: "user", content: "User 1" },
      { role: "assistant", content: "Assistant 1" },
      { role: "user", content: "User 2" },
      { role: "assistant", content: "Assistant 2" },
    ]);

    const userMessages = context.getMessagesByRole("user");
    assertEquals(userMessages.length, 2);
    assertEquals(userMessages[0].content, "User 1");
    assertEquals(userMessages[1].content, "User 2");

    const systemMessages = context.getMessagesByRole("system");
    assertEquals(systemMessages.length, 1);
  },
});

Deno.test({
  name: "Context: getLastMessages - get last N messages",
  fn() {
    const context = new ContextManager();

    context.addMessages([
      { role: "user", content: "1" },
      { role: "assistant", content: "2" },
      { role: "user", content: "3" },
      { role: "assistant", content: "4" },
      { role: "user", content: "5" },
    ]);

    const last2 = context.getLastMessages(2);
    assertEquals(last2.length, 2);
    assertEquals(last2[0].content, "4");
    assertEquals(last2[1].content, "5");
  },
});

// ============================================================
// Statistics tests
// ============================================================

Deno.test({
  name: "Context: getStats - calculate statistics",
  fn() {
    const context = new ContextManager();

    context.addMessages([
      { role: "system", content: "System" },
      { role: "user", content: "User 1" },
      { role: "user", content: "User 2" },
      { role: "assistant", content: "Assistant 1" },
      { role: "assistant", content: "Assistant 2" },
      { role: "assistant", content: "Assistant 3" },
      { role: "tool", content: "Tool result" },
    ]);

    const stats = context.getStats();
    assertEquals(stats.messageCount, 7);
    assertEquals(stats.systemMessages, 1);
    assertEquals(stats.userMessages, 2);
    assertEquals(stats.assistantMessages, 3);
    assertEquals(stats.toolMessages, 1);
    assertEquals(stats.estimatedTokens > 0, true);
  },
});

Deno.test({
  name: "Context: estimateTokens - simple estimation",
  fn() {
    const context = new ContextManager();

    // Add message with known length
    const content = "a".repeat(400); // 400 chars = ~100 tokens
    context.addMessage({ role: "user", content });

    const stats = context.getStats();
    // Should be around 100 tokens (400 / 4)
    assertEquals(stats.estimatedTokens >= 90, true);
    assertEquals(stats.estimatedTokens <= 110, true);
  },
});

// ============================================================
// Token Budget tests
// ============================================================

Deno.test({
  name: "Context: needsTrimming - detect when over budget",
  fn() {
    const context = new ContextManager({ maxTokens: 100 }); // Very small budget

    context.addMessage({ role: "user", content: "Short" });
    assertEquals(context.needsTrimming(), false);

    // Add large message
    context.addMessage({ role: "user", content: "a".repeat(500) }); // 500 chars = ~125 tokens
    assertEquals(context.needsTrimming(), true);
  },
});

Deno.test({
  name: "Context: trimIfNeeded - automatic trimming",
  fn() {
    const context = new ContextManager({
      maxTokens: 200,
      minMessages: 1,
    });

    // Add messages that exceed budget
    context.addMessage({ role: "user", content: "a".repeat(400) }); // ~100 tokens
    context.addMessage({ role: "assistant", content: "b".repeat(400) }); // ~100 tokens
    context.addMessage({ role: "user", content: "c".repeat(400) }); // ~100 tokens

    // Should have trimmed oldest message
    const messages = context.getMessages();
    assertEquals(messages.length < 3, true);
    assertEquals(context.needsTrimming(), false);
  },
});

Deno.test({
  name: "Context: trimIfNeeded - preserve system messages",
  fn() {
    const context = new ContextManager({
      maxTokens: 200,
      preserveSystem: true,
      minMessages: 1,
    });

    context.addMessage({ role: "system", content: "a".repeat(100) }); // ~25 tokens
    context.addMessage({ role: "user", content: "b".repeat(400) }); // ~100 tokens
    context.addMessage({ role: "assistant", content: "c".repeat(400) }); // ~100 tokens
    context.addMessage({ role: "user", content: "d".repeat(400) }); // ~100 tokens

    const messages = context.getMessages();

    // System message should still be present
    const systemMessages = messages.filter((m) => m.role === "system");
    assertEquals(systemMessages.length, 1);
  },
});

Deno.test({
  name: "Context: trimIfNeeded - respect minMessages",
  fn() {
    const context = new ContextManager({
      maxTokens: 50, // Very small
      minMessages: 3,
    });

    // Add more messages than minMessages
    for (let i = 0; i < 10; i++) {
      context.addMessage({ role: "user", content: "a".repeat(100) });
    }

    const messages = context.getMessages();

    // Should keep at least minMessages
    assertEquals(messages.length >= 3, true);
  },
});

Deno.test({
  name: "Context: overflowStrategy=summarize - inserts summary message",
  fn() {
    const context = new ContextManager({
      maxTokens: 50,
      overflowStrategy: "summarize",
      summaryKeepRecent: 2,
      summaryMaxChars: 200,
    });

    const longText = "a".repeat(200);
    context.addMessage({ role: "system", content: "You are helpful." });
    context.addMessage({ role: "user", content: `First ${longText}` });
    context.addMessage({ role: "assistant", content: `First response ${longText}` });
    context.addMessage({ role: "user", content: `Second ${longText}` });
    context.addMessage({ role: "assistant", content: `Second response ${longText}` });
    context.addMessage({ role: "user", content: `Third ${longText}` });

    const messages = context.getMessages();
    const summary = messages.find((m) =>
      m.content.startsWith("Summary of earlier context:")
    );
    assertEquals(Boolean(summary), true);

    // Should preserve recent messages
    const last = context.getLastMessages(2);
    assertEquals(last[0].role, "assistant");
    assertEquals(last[1].role, "user");
  },
});

Deno.test({
  name: "Context: overflowStrategy=fail - throw on overflow",
  fn() {
    const context = new ContextManager({
      maxTokens: 50,
      overflowStrategy: "fail",
    });

    context.addMessage({ role: "user", content: "short" });

    assertThrows(
      () => context.addMessage({ role: "user", content: "a".repeat(400) }),
      ContextOverflowError,
    );
  },
});

Deno.test({
  name: "Context: updateConfig - fail strategy throws if already over budget",
  fn() {
    const context = new ContextManager({
      maxTokens: 200,
    });

    context.addMessage({ role: "user", content: "a".repeat(400) });
    context.addMessage({ role: "assistant", content: "b".repeat(400) });

    assertThrows(
      () => context.updateConfig({ maxTokens: 50, overflowStrategy: "fail" }),
      ContextOverflowError,
    );
  },
});

// ============================================================
// Result Truncation tests
// ============================================================

Deno.test({
  name: "Context: truncateResult - keep short results",
  fn() {
    const context = new ContextManager({ maxResultLength: 100 });

    const result = "Short result";
    const truncated = context.truncateResult(result);

    assertEquals(truncated, result);
  },
});

Deno.test({
  name: "Context: truncateResult - truncate long results with head+tail",
  fn() {
    const context = new ContextManager({ maxResultLength: 200 });

    const head = "HEAD_CONTENT_";
    const tail = "_TAIL_CONTENT";
    const result = head + "x".repeat(500) + tail;
    const truncated = context.truncateResult(result);

    assertEquals(truncated.length <= 200, true);
    // Head+tail strategy: preserves beginning and end
    assertEquals(truncated.startsWith("HEAD_CONTENT_"), true);
    assertEquals(truncated.endsWith("_TAIL_CONTENT"), true);
    assertEquals(truncated.includes("[truncated middle]"), true);
  },
});

Deno.test({
  name: "Context: truncateResult - uses truncateMiddle for tool results",
  fn() {
    const context = new ContextManager({ maxResultLength: 200 });

    const result = "a".repeat(500);
    const truncated = context.truncateResult(result);

    // Should be at most maxResultLength chars
    assertEquals(truncated.length <= 200, true);
    // Short results should pass through unchanged
    assertEquals(context.truncateResult("short"), "short");
  },
});

// ============================================================
// Configuration tests
// ============================================================

Deno.test({
  name: "Context: getConfig - retrieve configuration",
  fn() {
    const context = new ContextManager({
      maxTokens: 5000,
      maxResultLength: 1000,
    });

    const config = context.getConfig();
    assertEquals(config.maxTokens, 5000);
    assertEquals(config.maxResultLength, 1000);
  },
});

Deno.test({
  name: "Context: updateConfig - change configuration",
  fn() {
    const context = new ContextManager({ maxTokens: 12000 });

    context.updateConfig({ maxTokens: 6000 });

    const config = context.getConfig();
    assertEquals(config.maxTokens, 6000);
  },
});

Deno.test({
  name: "Context: updateConfig - trigger trimming if needed",
  fn() {
    const context = new ContextManager({ maxTokens: 10000, minMessages: 1 });

    // Add large messages
    for (let i = 0; i < 5; i++) {
      context.addMessage({ role: "user", content: "a".repeat(1000) });
    }

    const beforeCount = context.getMessages().length;

    // Reduce token budget (should trigger trim)
    context.updateConfig({ maxTokens: 500 });

    const afterCount = context.getMessages().length;
    assertEquals(afterCount < beforeCount, true);
  },
});

Deno.test({
  name: "Context: default configuration values",
  fn() {
    const context = new ContextManager();

    const config = context.getConfig();
    assertEquals(config.maxTokens, DEFAULT_CONTEXT_CONFIG.maxTokens);
    assertEquals(config.maxResultLength, DEFAULT_CONTEXT_CONFIG.maxResultLength);
    assertEquals(config.preserveSystem, DEFAULT_CONTEXT_CONFIG.preserveSystem);
    assertEquals(config.minMessages, DEFAULT_CONTEXT_CONFIG.minMessages);
    assertEquals(config.overflowStrategy, DEFAULT_CONTEXT_CONFIG.overflowStrategy);
    assertEquals(config.summaryMaxChars, DEFAULT_CONTEXT_CONFIG.summaryMaxChars);
    assertEquals(config.summaryKeepRecent, DEFAULT_CONTEXT_CONFIG.summaryKeepRecent);
  },
});
