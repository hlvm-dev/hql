/**
 * LLM Fixtures Tests
 *
 * Validates deterministic fixture loading and scripted responses.
 */

import { assertEquals, assertRejects } from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  createFixtureLLM,
  loadLlmFixture,
  type LlmFixture,
} from "../../../src/hlvm/agent/llm-fixtures.ts";

const platform = getPlatform();

async function withTempFixture(content: string): Promise<string> {
  const dir = await platform.fs.makeTempDir({ prefix: "hlvm-fixture-" });
  const path = platform.path.join(dir, "fixture.json");
  await platform.fs.writeTextFile(path, content);
  return path;
}

Deno.test({
  name: "LLM Fixtures: loadLlmFixture loads valid file",
  async fn() {
    const fixture: LlmFixture = {
      version: 1,
      name: "test",
      cases: [
        {
          name: "case-a",
          match: { contains: ["hello"] },
          steps: [{ response: "OK" }],
        },
      ],
    };

    const path = await withTempFixture(JSON.stringify(fixture));
    const loaded = await loadLlmFixture(path);

    assertEquals(loaded.version, 1);
    assertEquals(loaded.cases.length, 1);
    assertEquals(loaded.cases[0].name, "case-a");
  },
});

Deno.test({
  name: "LLM Fixtures: loadLlmFixture rejects invalid JSON",
  async fn() {
    const path = await withTempFixture("{not-json");
    await assertRejects(
      async () => await loadLlmFixture(path),
      Error,
      "Invalid JSON",
    );
  },
});

Deno.test({
  name: "LLM Fixtures: createFixtureLLM selects case by user message",
  async fn() {
    const fixture: LlmFixture = {
      version: 1,
      cases: [
        {
          name: "alpha",
          match: { contains: ["alpha"] },
          steps: [{ response: "A1" }],
        },
        {
          name: "beta",
          match: { contains: ["beta"] },
          steps: [{ response: "B1" }],
        },
      ],
    };

    const llm = createFixtureLLM(fixture);
    const response = await llm([{ role: "user", content: "beta task" }]);
    assertEquals(response.content, "B1");
    assertEquals(response.toolCalls.length, 0);
  },
});

Deno.test({
  name: "LLM Fixtures: createFixtureLLM enforces step expectations",
  async fn() {
    const fixture: LlmFixture = {
      version: 1,
      cases: [
        {
          name: "expect",
          match: { contains: ["check"] },
          steps: [{
            response: "OK",
            expect: { contains: ["[Tool Result]"], messageCount: 2 },
          }],
        },
      ],
    };

    const llm = createFixtureLLM(fixture);
    await assertRejects(
      async () =>
        await llm([
          { role: "user", content: "check" },
        ]),
      Error,
      "expect mismatch",
    );
  },
});

Deno.test({
  name: "LLM Fixtures: createFixtureLLM throws when steps exhausted",
  async fn() {
    const fixture: LlmFixture = {
      version: 1,
      cases: [
        {
          name: "single",
          steps: [{ response: "only" }],
        },
      ],
    };

    const llm = createFixtureLLM(fixture);
    const response = await llm([{ role: "user", content: "any" }]);
    assertEquals(response.content, "only");

    await assertRejects(
      async () => await llm([{ role: "user", content: "any" }]),
      Error,
      "fixture exhausted",
    );
  },
});

Deno.test({
  name: "LLM Fixtures: respects AbortSignal",
  async fn() {
    const fixture: LlmFixture = {
      version: 1,
      cases: [
        {
          name: "abort",
          steps: [{ response: "OK" }],
        },
      ],
    };

    const llm = createFixtureLLM(fixture);
    const controller = new AbortController();
    controller.abort();

    await assertRejects(
      async () => await llm([{ role: "user", content: "any" }], controller.signal),
      Error,
      "aborted",
    );
  },
});
