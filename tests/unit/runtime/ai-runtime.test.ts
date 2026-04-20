import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { http } from "../../../src/common/http-client.ts";
import {
  resetHlvmDirCacheForTests,
  setHlvmDirForTests,
} from "../../../src/common/paths.ts";
import {
  aiEngine,
  isCompatibleAIRunning,
  shutdownManagedAIRuntime,
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

Deno.test("shutdownManagedAIRuntime terminates the managed listener and orphaned runners", async () => {
  const originalPlatform = getPlatform();
  const originalFetchRaw = http.fetchRaw;
  const runtimeRoot = "/tmp/hlvm-ai-runtime-test/.runtime";
  const alivePids = new Set(["321", "654"]);

  setHlvmDirForTests("/tmp/hlvm-ai-runtime-test");
  (http as { fetchRaw: typeof http.fetchRaw }).fetchRaw = () =>
    Promise.reject(new Error("offline"));

  setPlatform({
    ...originalPlatform,
    process: {
      ...originalPlatform.process,
      pid: () => 999,
    },
    command: {
      ...originalPlatform.command,
      output: async ({ cmd }) => {
        if (cmd[0] === "lsof") {
          return {
            code: 0,
            success: true,
            stdout: new TextEncoder().encode(alivePids.has("321") ? "321\n" : ""),
            stderr: new Uint8Array(),
          };
        }
        if (cmd[0] === "kill") {
          const pid = cmd.at(-1) ?? "";
          alivePids.delete(pid);
          return {
            code: 0,
            success: true,
            stdout: new Uint8Array(),
            stderr: new Uint8Array(),
          };
        }
        if (cmd[0] === "ps" && cmd[1] === "-axo") {
          return {
            code: 0,
            success: true,
            stdout: new TextEncoder().encode(
              [
                `321 ${runtimeRoot}/engine/ollama serve`,
                `654 ${runtimeRoot}/engine/ollama runner --ollama-engine --model ${runtimeRoot}/models/blobs/sha256-test --port 60000`,
              ].join("\n"),
            ),
            stderr: new Uint8Array(),
          };
        }
        if (cmd[0] === "ps" && cmd[1] === "-p") {
          const pid = cmd[2];
          if (alivePids.has(pid)) {
            return {
              code: 0,
              success: true,
              stdout: new TextEncoder().encode(`${pid}\n`),
              stderr: new Uint8Array(),
            };
          }
          throw new Error("process not found");
        }
        throw new Error(`Unexpected command: ${cmd.join(" ")}`);
      },
    },
  });

  try {
    await shutdownManagedAIRuntime();
    assertEquals([...alivePids].length, 0);
  } finally {
    setPlatform(originalPlatform);
    (http as { fetchRaw: typeof http.fetchRaw }).fetchRaw = originalFetchRaw;
    resetHlvmDirCacheForTests();
  }
});
