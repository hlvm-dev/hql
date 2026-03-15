import { assert, assertEquals } from "jsr:@std/assert";
import {
  calculateScrollWindow,
  getRelativeIndex,
  handleNavigationKey,
  isNavigationKey,
  shouldCloseOnInput,
} from "../../../../src/hlvm/cli/repl-ink/completion/navigation.ts";
import type { ScrollWindow } from "../../../../src/hlvm/cli/repl-ink/completion/types.ts";

Deno.test("completion navigation: arrow keys wrap, enter selects, and tab/escape cancel", () => {
  assertEquals(handleNavigationKey("ArrowDown", 0, 5, true), {
    newIndex: 1,
    action: "navigate",
  });
  assertEquals(handleNavigationKey("ArrowDown", 4, 5, true), {
    newIndex: 0,
    action: "navigate",
  });
  assertEquals(handleNavigationKey("ArrowUp", 0, 5, true), {
    newIndex: 4,
    action: "navigate",
  });
  assertEquals(handleNavigationKey("Enter", 3, 5, true), {
    newIndex: 3,
    action: "select",
  });
  assertEquals(handleNavigationKey("Tab", 2, 5, true), {
    newIndex: -1,
    action: "cancel",
  });
  assertEquals(handleNavigationKey("Escape", 2, 5, true), {
    newIndex: -1,
    action: "cancel",
  });
});

Deno.test("completion navigation: hidden, empty, or unknown inputs are no-ops", () => {
  assertEquals(handleNavigationKey("ArrowDown", 0, 5, false), {
    newIndex: 0,
    action: "none",
  });
  assertEquals(handleNavigationKey("ArrowDown", 0, 0, true), {
    newIndex: 0,
    action: "none",
  });
  assertEquals(handleNavigationKey("a", 2, 5, true), {
    newIndex: 2,
    action: "none",
  });
});

Deno.test("completion navigation: scroll windows fit, center, and clamp correctly", () => {
  assertEquals(calculateScrollWindow(0, 5, 8), { start: 0, end: 5 });
  assertEquals(calculateScrollWindow(10, 20, 8), { start: 6, end: 14 });
  assertEquals(calculateScrollWindow(1, 20, 8), { start: 0, end: 8 });
  assertEquals(calculateScrollWindow(18, 20, 8), { start: 12, end: 20 });
});


Deno.test("completion navigation: relative indices are computed only for visible items", () => {
  const window: ScrollWindow = { start: 5, end: 13 };

  assertEquals(getRelativeIndex(7, window), 2);
  assertEquals(getRelativeIndex(3, window), -1);
  assertEquals(getRelativeIndex(15, window), -1);
});

Deno.test("completion navigation: navigation key detection covers handled keys only", () => {
  for (const key of ["ArrowUp", "ArrowDown", "Tab", "Enter", "Escape"]) {
    assert(isNavigationKey(key));
  }
  for (const key of ["a", "Backspace", "Delete", " "]) {
    assert(!isNavigationKey(key));
  }
});

Deno.test("completion navigation: input closes on edits but not on handled navigation", () => {
  for (const key of ["ArrowUp", "ArrowDown", "Tab", "Enter", "Escape"]) {
    assert(!shouldCloseOnInput(key, ""));
  }
  assert(shouldCloseOnInput("a", "a"));
  assert(shouldCloseOnInput("1", "1"));
  assert(shouldCloseOnInput(" ", " "));
  assert(shouldCloseOnInput("Backspace", ""));
  assert(shouldCloseOnInput("Delete", ""));
});
