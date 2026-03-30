import { assertEquals } from "jsr:@std/assert";
import {
  createNativeProviderTools,
  getNativeProviderCapabilityAvailability,
} from "../../../src/hlvm/providers/native-web-tools.ts";

Deno.test("native web tools: Google native search uses the current empty options shape", () => {
  const calls: unknown[] = [];
  const tools = createNativeProviderTools("google", {
    tools: {
      googleSearch: (options?: Record<string, never>) => {
        calls.push(options ?? null);
        return { type: "provider", id: "google.google_search", args: options ?? {} };
      },
    },
  });

  assertEquals(calls, [{}]);
  assertEquals("web_search" in tools, true);
  assertEquals(getNativeProviderCapabilityAvailability(tools).webSearch, true);
});
