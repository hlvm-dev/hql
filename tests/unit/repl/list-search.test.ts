import { assertEquals } from "jsr:@std/assert";
import { buildSearchFieldDisplay } from "../../../src/hlvm/cli/repl-ink/components/ListSearchField.tsx";
import { buildCursorWindowDisplay } from "../../../src/hlvm/cli/repl-ink/utils/cursor-window.ts";
import { getListSearchSeed } from "../../../src/hlvm/cli/repl-ink/utils/list-search.ts";
import type { KeyInfo } from "../../../src/hlvm/cli/repl-ink/utils/text-editing.ts";

function key(overrides: Partial<KeyInfo> = {}): KeyInfo {
  return {
    ctrl: false,
    meta: false,
    shift: false,
    escape: false,
    return: false,
    tab: false,
    backspace: false,
    delete: false,
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    ...overrides,
  };
}

Deno.test("list-search: plain typing starts search", () => {
  assertEquals(getListSearchSeed("a", key()), "a");
  assertEquals(getListSearchSeed("model", key()), "model");
});

Deno.test("list-search: reserved single-key shortcuts do not start search", () => {
  assertEquals(
    getListSearchSeed("/", key(), { reservedSingleKeys: ["/", "j", "k"] }),
    null,
  );
  assertEquals(
    getListSearchSeed("j", key(), { reservedSingleKeys: ["/", "j", "k"] }),
    null,
  );
});

Deno.test("list-search: modified and navigation keys do not start search", () => {
  assertEquals(getListSearchSeed("a", key({ ctrl: true })), null);
  assertEquals(getListSearchSeed("a", key({ meta: true })), null);
  assertEquals(getListSearchSeed("a", key({ upArrow: true })), null);
  assertEquals(getListSearchSeed("\n", key()), null);
});

Deno.test("list-search: search field keeps short value intact", () => {
  assertEquals(buildSearchFieldDisplay("model", 5, 12), {
    beforeCursor: "model",
    cursorChar: " ",
    afterCursor: "",
  });
});

Deno.test("list-search: search field keeps cursor visible when truncated", () => {
  assertEquals(buildSearchFieldDisplay("abcdefghij", 9, 4), {
    beforeCursor: "ghi",
    cursorChar: "j",
    afterCursor: "",
  });
});

Deno.test("cursor-window: end-of-input cursor stays visible in long value", () => {
  assertEquals(buildCursorWindowDisplay("abcdefghij", 10, 4), {
    beforeCursor: "hij",
    cursorChar: " ",
    afterCursor: "",
    renderWidth: 4,
  });
});
