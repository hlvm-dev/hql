import { assertEquals } from "jsr:@std/assert";
import {
  shouldOpenMentionPickerOnTypedChar,
  shouldProcessComposerAutoTrigger,
} from "../../../src/hlvm/cli/repl-ink/input-auto-trigger.ts";
import { buildContext } from "../../../src/hlvm/cli/repl-ink/completion/providers.ts";

Deno.test("composer auto-trigger skips closed-picker cursor-only moves", () => {
  assertEquals(
    shouldProcessComposerAutoTrigger(
      "@docs/api/runtime.md",
      "@docs/api/runtime.md",
      false,
    ),
    false,
  );
});

Deno.test("composer auto-trigger still reacts to text edits when picker is closed", () => {
  assertEquals(
    shouldProcessComposerAutoTrigger("@docs", "@docs/", false),
    true,
  );
});

Deno.test("composer auto-trigger continues processing while picker is visible", () => {
  assertEquals(
    shouldProcessComposerAutoTrigger(
      "@docs/api/runtime.md",
      "@docs/api/runtime.md",
      true,
    ),
    true,
  );
});

Deno.test("mention picker opens only from an explicit @ keystroke", () => {
  const context = buildContext(
    "@",
    1,
    new Set(),
    new Map(),
    new Map(),
    new Set(),
  );

  assertEquals(
    shouldOpenMentionPickerOnTypedChar("@", false, false, context),
    true,
  );
  assertEquals(
    shouldOpenMentionPickerOnTypedChar("@", true, false, context),
    false,
  );
  assertEquals(
    shouldOpenMentionPickerOnTypedChar("@", false, true, context),
    false,
  );
  assertEquals(
    shouldOpenMentionPickerOnTypedChar("d", false, false, context),
    false,
  );
});
