import { assertEquals, assertNotEquals, assertStrictEquals } from "jsr:@std/assert@1";
import {
  getBannerRowCount,
  getBannerLogoColors,
  interpolateHexColor,
  resolveBannerAiIndicator,
  shouldUseCompactBanner,
} from "../../../src/hlvm/cli/repl-ink/components/Banner.tsx";
import { THEMES } from "../../../src/hlvm/cli/theme/index.ts";

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

Deno.test("interpolateHexColor blends between palette stops", () => {
  assertEquals(interpolateHexColor("#000000", "#ffffff", 0), "#000000");
  assertEquals(interpolateHexColor("#000000", "#ffffff", 1), "#ffffff");
  assertEquals(interpolateHexColor("#000000", "#ffffff", 0.5), "#808080");
});

Deno.test("getBannerLogoColors builds and caches a theme-aware six-line ramp", () => {
  const colors = getBannerLogoColors("sicp", THEMES.sicp, false);
  const cached = getBannerLogoColors("sicp", THEMES.sicp, false);

  assertEquals(colors.length, 6);
  assertEquals(colors[0], THEMES.sicp.primary);
  assertEquals(colors.at(-1), THEMES.sicp.success);
  assertNotEquals(colors[1], colors[0]);
  assertStrictEquals(colors, cached);
});

Deno.test("getBannerLogoColors keeps compact mode single-color", () => {
  assertEquals(
    getBannerLogoColors("nord", THEMES.nord, true),
    [THEMES.nord.primary],
  );
});
