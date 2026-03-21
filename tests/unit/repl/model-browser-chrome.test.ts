import { assertEquals } from "jsr:@std/assert@1";
import {
  buildModelBrowserFocusLayout,
  buildModelBrowserScopeText,
  buildModelBrowserViewLayout,
} from "../../../src/hlvm/cli/repl-ink/components/model-browser-chrome.ts";

Deno.test("buildModelBrowserScopeText truncates the active scope value", () => {
  assertEquals(
    buildModelBrowserScopeText(
      "Default model",
      "claude-code/claude-haiku-4-5-20251001",
      18,
    ),
    "Default model: claude-code/claud…",
  );
  assertEquals(
    buildModelBrowserScopeText("Default model", undefined, 18),
    "Default model: none",
  );
});

Deno.test("buildModelBrowserViewLayout keeps the next-view hint in a stable right slot", () => {
  const layout = buildModelBrowserViewLayout(42, "Installed", "8/21", "Cloud");

  assertEquals(layout.rightText, "Tab → Cloud");
  assertEquals(
    layout.leftText.length + layout.gapWidth + layout.rightText.length,
    42,
  );
});

Deno.test("buildModelBrowserFocusLayout reserves status space for the focused model", () => {
  const layout = buildModelBrowserFocusLayout(
    40,
    "gpt-4.1-mini",
    "default",
  );

  assertEquals(layout.rightText, "[default]");
  assertEquals(
    layout.leftText.length + layout.gapWidth + layout.rightText.length,
    40,
  );
});
