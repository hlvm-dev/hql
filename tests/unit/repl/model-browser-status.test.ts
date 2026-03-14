import { assertEquals } from "jsr:@std/assert@1";
import {
  getModelStatusLabel,
  getStatusIndicator,
  MODEL_BROWSER_FOCUSED_LABEL,
  MODEL_BROWSER_SELECT_ACTION_LABEL,
} from "../../../src/hlvm/cli/repl-ink/components/model-browser-status.ts";

Deno.test("model browser labels the active model as default", () => {
  assertEquals(getModelStatusLabel("active"), "default");
  assertEquals(getStatusIndicator("active"), "* ");
});

Deno.test("model browser uses a neutral indicator for installed models", () => {
  assertEquals(getModelStatusLabel("installed"), "installed");
  assertEquals(getStatusIndicator("installed"), "○ ");
});

Deno.test("model browser copy distinguishes focus from selection", () => {
  assertEquals(MODEL_BROWSER_FOCUSED_LABEL, "Focused");
  assertEquals(MODEL_BROWSER_SELECT_ACTION_LABEL, "make default");
});
