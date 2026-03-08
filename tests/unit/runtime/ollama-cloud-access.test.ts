import { assertEquals } from "jsr:@std/assert";
import {
  ensureOllamaCloudAccess,
  isOllamaCloudModelId,
} from "../../../src/hlvm/runtime/ollama-cloud-access.ts";

Deno.test("ollama cloud access: detects Ollama cloud model ids only", () => {
  assertEquals(isOllamaCloudModelId("ollama/deepseek-v3.1:671b-cloud"), true);
  assertEquals(isOllamaCloudModelId("ollama/llama3.1:8b"), false);
  assertEquals(isOllamaCloudModelId("openai/gpt-4o"), false);
  assertEquals(isOllamaCloudModelId("deepseek-v3.1:671b-cloud"), false);
});

Deno.test("ollama cloud access: ensure returns available without signin when already verified", async () => {
  const result = await ensureOllamaCloudAccess("ollama/deepseek-v3.1:671b-cloud", {
    verifyAccess: async () => true,
    runSignin: async () => false,
  });
  assertEquals(result, { ok: true, status: "available" });
});

Deno.test("ollama cloud access: ensure reports signin and verification failures", async () => {
  const signinFailed = await ensureOllamaCloudAccess("ollama/deepseek-v3.1:671b-cloud", {
    verifyAccess: async () => false,
    runSignin: async () => false,
  });
  assertEquals(signinFailed, { ok: false, status: "signin_failed" });

  let waitCount = 0;
  const verificationFailed = await ensureOllamaCloudAccess(
    "ollama/deepseek-v3.1:671b-cloud",
    {
      verifyAccess: async () => false,
      runSignin: async () => true,
      timeoutMs: 2,
      intervalMs: 1,
      sleep: async () => {
        waitCount += 1;
      },
    },
  );
  assertEquals(verificationFailed, {
    ok: false,
    status: "verification_failed",
  });
  assertEquals(waitCount > 0, true);
});
