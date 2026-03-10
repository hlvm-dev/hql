import { assertEquals } from "jsr:@std/assert@1";
import {
  getBannerRowCount,
  resolveBannerAiIndicator,
  shouldUseCompactBanner,
} from "../../../src/hlvm/cli/repl-ink/components/Banner.tsx";

Deno.test("resolveBannerAiIndicator reflects runtime readiness", () => {
  assertEquals(
    resolveBannerAiIndicator(true, "available"),
    { label: "AI available", tone: "success" },
  );
  assertEquals(
    resolveBannerAiIndicator(true, "setup_required"),
    { label: "AI setup required", tone: "warning" },
  );
  assertEquals(
    resolveBannerAiIndicator(false, "available"),
    { label: "AI unavailable", tone: "error" },
  );
});

Deno.test("shouldUseCompactBanner activates for narrow terminals", () => {
  assertEquals(shouldUseCompactBanner(32), true);
  assertEquals(shouldUseCompactBanner(80), false);
});

Deno.test("shouldUseCompactBanner activates for short terminals", () => {
  assertEquals(shouldUseCompactBanner(80, 20), true);
  assertEquals(shouldUseCompactBanner(80, 28), false);
});

Deno.test("getBannerRowCount matches compact and full banner footprints", () => {
  assertEquals(getBannerRowCount(0, 80, 28), 10);
  assertEquals(getBannerRowCount(1, 80, 28), 11);
  assertEquals(getBannerRowCount(0, 32, 28), 4);
});
