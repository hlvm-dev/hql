import { assertEquals } from "jsr:@std/assert@1";
import { resolveBannerAiIndicator } from "../../../src/hlvm/cli/repl-ink/components/Banner.tsx";

Deno.test("banner AI indicator: reports available only when helpers and backend are ready", () => {
  assertEquals(
    resolveBannerAiIndicator(true, "available"),
    { label: "AI available", tone: "success" },
  );
  assertEquals(
    resolveBannerAiIndicator(true, "setup_required"),
    { label: "AI setup required", tone: "warning" },
  );
  assertEquals(
    resolveBannerAiIndicator(true, "unavailable"),
    { label: "AI unavailable", tone: "error" },
  );
  assertEquals(
    resolveBannerAiIndicator(false, "available"),
    { label: "AI unavailable", tone: "error" },
  );
});
