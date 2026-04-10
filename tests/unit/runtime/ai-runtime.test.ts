import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { http } from "../../../src/common/http-client.ts";
import { aiEngine } from "../../../src/hlvm/runtime/ai-runtime.ts";
import { getPlatform, setPlatform } from "../../../src/platform/platform.ts";

Deno.test("aiEngine.isRunning returns true when ollama endpoint responds OK", async () => {
  const originalFetchRaw = http.fetchRaw;

  (http as { fetchRaw: typeof http.fetchRaw }).fetchRaw = () =>
    Promise.resolve(new Response("OK", { status: 200 }));

  try {
    const running = await aiEngine.isRunning();
    assertEquals(running, true);
  } finally {
    (http as { fetchRaw: typeof http.fetchRaw }).fetchRaw = originalFetchRaw;
  }
});

Deno.test("aiEngine.isRunning returns false when ollama endpoint throws", async () => {
  const originalFetchRaw = http.fetchRaw;

  (http as { fetchRaw: typeof http.fetchRaw }).fetchRaw = () =>
    Promise.reject(new Error("offline"));

  try {
    const running = await aiEngine.isRunning();
    assertEquals(running, false);
  } finally {
    (http as { fetchRaw: typeof http.fetchRaw }).fetchRaw = originalFetchRaw;
  }
});

Deno.test("aiEngine.getEnginePath fails closed when the embedded engine is unavailable", async () => {
  const originalPlatform = getPlatform();
  setPlatform({
    ...originalPlatform,
    fs: {
      ...originalPlatform.fs,
      exists: async () => false,
    },
  });

  try {
    await assertRejects(
      () => aiEngine.getEnginePath(),
      Error,
      "Embedded AI engine is unavailable",
    );
  } finally {
    setPlatform(originalPlatform);
  }
});
