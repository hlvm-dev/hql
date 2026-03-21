import {
  assertEquals,
  assertNotEquals,
  assertStrictEquals,
} from "jsr:@std/assert@1";
import {
  getBannerLogoColors,
  getBannerRowCount,
  interpolateHexColor,
  resolveBannerAiIndicator,
  shouldUseCompactBanner,
} from "../../../src/hlvm/cli/repl-ink/components/Banner.tsx";
import { THEMES } from "../../../src/hlvm/cli/theme/index.ts";
import { buildSemanticColors } from "../../../src/hlvm/cli/theme/semantic.ts";

Deno.test("resolveBannerAiIndicator reflects runtime readiness", () => {
  assertEquals(
    resolveBannerAiIndicator(true, "available"),
    { label: "AI available", tone: "ready" },
  );
  assertEquals(
    resolveBannerAiIndicator(true, "setup_required"),
    { label: "AI setup required", tone: "attention" },
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
  assertEquals(getBannerRowCount(0, 80, 28), 9);
  assertEquals(getBannerRowCount(1, 80, 28), 10);
  assertEquals(getBannerRowCount(0, 32, 28), 4);
});

Deno.test("interpolateHexColor blends between palette stops", () => {
  assertEquals(interpolateHexColor("#000000", "#ffffff", 0), "#000000");
  assertEquals(interpolateHexColor("#000000", "#ffffff", 1), "#ffffff");
  assertEquals(interpolateHexColor("#000000", "#ffffff", 0.5), "#808080");
});

Deno.test("getBannerLogoColors builds and caches a theme-aware banner ramp", () => {
  const banner = buildSemanticColors(THEMES.sicp).banner;
  const colors = getBannerLogoColors("sicp", banner, false);
  const cached = getBannerLogoColors("sicp", banner, false);

  assertEquals(colors.length, 5);
  assertEquals(colors[0], banner.logoStart);
  assertEquals(colors.at(-1), banner.logoEnd);
  assertNotEquals(colors[1], colors[0]);
  assertNotEquals(colors.at(-1), THEMES.sicp.success);
  assertStrictEquals(colors, cached);
});

Deno.test("getBannerLogoColors keeps compact mode single-color", () => {
  assertEquals(
    getBannerLogoColors("nord", buildSemanticColors(THEMES.nord).banner, true),
    [THEMES.nord.primary],
  );
});

Deno.test("buildSemanticColors keeps SICP banner status colors off success gold", () => {
  const banner = buildSemanticColors(THEMES.sicp).banner;

  assertEquals(banner.status.ready, THEMES.sicp.accent);
  assertEquals(banner.status.attention, THEMES.sicp.secondary);
  assertEquals(banner.status.error, THEMES.sicp.error);
  assertNotEquals(banner.status.ready, THEMES.sicp.success);
});
