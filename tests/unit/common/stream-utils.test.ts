import { assertEquals } from "jsr:@std/assert@1";
import { collectAsyncGenerator } from "../../../src/common/stream-utils.ts";

Deno.test("collectAsyncGenerator: collects string chunks", async () => {
  async function* gen() {
    yield "Hello";
    yield " ";
    yield "World";
  }
  assertEquals(await collectAsyncGenerator(gen()), "Hello World");
});

Deno.test("collectAsyncGenerator: returns empty string for empty generator", async () => {
  async function* gen() {
    // empty
  }
  assertEquals(await collectAsyncGenerator(gen()), "");
});

Deno.test("collectAsyncGenerator: respects abort signal", async () => {
  const controller = new AbortController();

  async function* gen() {
    yield "a";
    controller.abort();
    yield "b";
    yield "c";
  }

  const result = await collectAsyncGenerator(gen(), controller.signal);
  // "a" is yielded and collected. Then abort() is called.
  // "b" is yielded but signal.aborted is true → break before push.
  assertEquals(result, "a");
});
