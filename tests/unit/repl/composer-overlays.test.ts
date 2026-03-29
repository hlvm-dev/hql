import { assertEquals } from "jsr:@std/assert@1";
import {
  canOpenComposerSurface,
  resolveActiveComposerSurface,
} from "../../../src/hlvm/cli/repl-ink/utils/composer-overlays.ts";

Deno.test("resolveActiveComposerSurface prioritizes history over all other surfaces", () => {
  assertEquals(
    resolveActiveComposerSurface({
      isHistorySearching: true,
      hasPlaceholderMode: true,
      hasCompletion: true,
    }),
    "history",
  );
});

Deno.test("resolveActiveComposerSurface prioritizes placeholders over completion", () => {
  assertEquals(
    resolveActiveComposerSurface({
      isHistorySearching: false,
      hasPlaceholderMode: true,
      hasCompletion: true,
    }),
    "placeholder",
  );
});

Deno.test("resolveActiveComposerSurface falls back to completion when it is the only active surface", () => {
  assertEquals(
    resolveActiveComposerSurface({
      isHistorySearching: false,
      hasPlaceholderMode: false,
      hasCompletion: true,
    }),
    "completion",
  );
});

Deno.test("canOpenComposerSurface only allows a new surface when none is active or it already owns focus", () => {
  assertEquals(canOpenComposerSurface("none", "completion"), true);
  assertEquals(canOpenComposerSurface("completion", "completion"), true);
  assertEquals(canOpenComposerSurface("history", "completion"), false);
});
