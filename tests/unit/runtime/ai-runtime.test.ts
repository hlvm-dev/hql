import { assertEquals } from "jsr:@std/assert";
import { ai } from "../../../src/hlvm/api/ai.ts";
import { aiEngine } from "../../../src/hlvm/runtime/ai-runtime.ts";

Deno.test("aiEngine.isRunning checks ollama provider explicitly", async () => {
  const originalStatus = ai.status;
  let providerNameArg: string | undefined;

  (ai as { status: (providerName?: string) => Promise<{ available: boolean }> }).status = async (providerName?: string) => {
    providerNameArg = providerName;
    return { available: true };
  };

  try {
    const running = await aiEngine.isRunning();
    assertEquals(running, true);
    assertEquals(providerNameArg, "ollama");
  } finally {
    (ai as { status: typeof ai.status }).status = originalStatus;
  }
});

Deno.test("aiEngine.isRunning returns false when ollama status check throws", async () => {
  const originalStatus = ai.status;

  (ai as { status: (providerName?: string) => Promise<{ available: boolean }> }).status = async () => {
    throw new Error("offline");
  };

  try {
    const running = await aiEngine.isRunning();
    assertEquals(running, false);
  } finally {
    (ai as { status: typeof ai.status }).status = originalStatus;
  }
});
