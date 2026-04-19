import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { http } from "../../../src/common/http-client.ts";
import {
  aiEngine,
  isCompatibleAIRunning,
} from "../../../src/hlvm/runtime/ai-runtime.ts";
import { LOCAL_FALLBACK_MODEL } from "../../../src/hlvm/runtime/bootstrap-manifest.ts";
import { getPlatform, setPlatform } from "../../../src/platform/platform.ts";

type MockResponder = (url: string) => Response | Promise<Response>;

function installHttpMock(responder: MockResponder) {
  const original = http.fetchRaw;
  (http as { fetchRaw: typeof http.fetchRaw }).fetchRaw = ((
    input: string | URL,
  ) => Promise.resolve(responder(String(input)))) as typeof http.fetchRaw;
  return () => {
    (http as { fetchRaw: typeof http.fetchRaw }).fetchRaw = original;
  };
}

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

Deno.test("isCompatibleAIRunning: version-only mode (legacy callers) skips model probe", async () => {
  const restore = installHttpMock((url) => {
    if (url.endsWith("/api/version")) {
      return new Response(JSON.stringify({ version: "0.21.0" }), {
        status: 200,
      });
    }
    if (url.endsWith("/api/tags")) {
      // Would be empty, but we assert this is not consulted in version-only mode
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    }
    return new Response("OK", { status: 200 });
  });

  try {
    // No expectedModels → must not reject on empty tags.
    assertEquals(await isCompatibleAIRunning("0.21.0"), true);
    assertEquals(await isCompatibleAIRunning("0.21.0", []), true);
  } finally {
    restore();
  }
});

Deno.test("isCompatibleAIRunning: version matches but no expected model served → incompatible (the 21.7s-hang bug)", async () => {
  const restore = installHttpMock((url) => {
    if (url.endsWith("/api/version")) {
      return new Response(JSON.stringify({ version: "0.21.0" }), {
        status: 200,
      });
    }
    if (url.endsWith("/api/tags")) {
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    }
    return new Response("OK", { status: 200 });
  });

  try {
    const compatible = await isCompatibleAIRunning("0.21.0", [
      LOCAL_FALLBACK_MODEL,
    ]);
    assertEquals(
      compatible,
      false,
      "Ollama with empty models dir must be classified incompatible so the caller reclaims it",
    );
  } finally {
    restore();
  }
});

Deno.test("isCompatibleAIRunning: version matches and expected model served → compatible", async () => {
  const restore = installHttpMock((url) => {
    if (url.endsWith("/api/version")) {
      return new Response(JSON.stringify({ version: "0.21.0" }), {
        status: 200,
      });
    }
    if (url.endsWith("/api/tags")) {
      return new Response(
        JSON.stringify({
          models: [
            { name: LOCAL_FALLBACK_MODEL, model: LOCAL_FALLBACK_MODEL },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response("OK", { status: 200 });
  });

  try {
    const compatible = await isCompatibleAIRunning("0.21.0", [
      LOCAL_FALLBACK_MODEL,
    ]);
    assertEquals(compatible, true);
  } finally {
    restore();
  }
});

Deno.test("isCompatibleAIRunning: version mismatch short-circuits before model probe", async () => {
  let tagsProbeCalls = 0;
  const restore = installHttpMock((url) => {
    if (url.endsWith("/api/version")) {
      return new Response(JSON.stringify({ version: "0.20.0" }), {
        status: 200,
      });
    }
    if (url.endsWith("/api/tags")) {
      tagsProbeCalls++;
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    }
    return new Response("OK", { status: 200 });
  });

  try {
    assertEquals(
      await isCompatibleAIRunning("0.21.0", [LOCAL_FALLBACK_MODEL]),
      false,
    );
    assertEquals(
      tagsProbeCalls,
      0,
      "version mismatch should skip the more expensive /api/tags probe",
    );
  } finally {
    restore();
  }
});

Deno.test("isCompatibleAIRunning: /api/tags non-ok response → incompatible", async () => {
  const restore = installHttpMock((url) => {
    if (url.endsWith("/api/version")) {
      return new Response(JSON.stringify({ version: "0.21.0" }), {
        status: 200,
      });
    }
    if (url.endsWith("/api/tags")) {
      return new Response("boom", { status: 500 });
    }
    return new Response("OK", { status: 200 });
  });

  try {
    assertEquals(
      await isCompatibleAIRunning("0.21.0", [LOCAL_FALLBACK_MODEL]),
      false,
    );
  } finally {
    restore();
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
      "AI engine is unavailable",
    );
  } finally {
    setPlatform(originalPlatform);
  }
});
