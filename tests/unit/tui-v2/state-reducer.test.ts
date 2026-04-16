import { assertEquals } from "https://deno.land/std/assert/mod.ts";
import { appReducer } from "../../../src/hlvm/tui-v2/state/reducer.ts";
import { initialAppState } from "../../../src/hlvm/tui-v2/state/types.ts";

Deno.test("set_input updates text and cursor", () => {
  const state = initialAppState();
  const next = appReducer(state, {
    type: "set_input",
    text: "hello world",
    cursor: 5,
  });
  assertEquals(next.inputText, "hello world");
  assertEquals(next.cursorOffset, 5);
});

Deno.test("toggle_mode switches chat to code and back", () => {
  const state = initialAppState();
  assertEquals(state.inputMode, "chat");

  const toggled = appReducer(state, { type: "toggle_mode" });
  assertEquals(toggled.inputMode, "code");

  const toggledBack = appReducer(toggled, { type: "toggle_mode" });
  assertEquals(toggledBack.inputMode, "chat");
});

Deno.test("set_loading updates loading state", () => {
  const state = initialAppState();
  assertEquals(state.isLoading, false);

  const loading = appReducer(state, { type: "set_loading", loading: true });
  assertEquals(loading.isLoading, true);

  const done = appReducer(loading, { type: "set_loading", loading: false });
  assertEquals(done.isLoading, false);
});

Deno.test("set_model updates model id and display name", () => {
  const state = initialAppState();
  assertEquals(state.activeModelId, null);
  assertEquals(state.activeModelDisplay, "auto");

  const next = appReducer(state, {
    type: "set_model",
    id: "gpt-4o",
    display: "GPT-4o",
  });
  assertEquals(next.activeModelId, "gpt-4o");
  assertEquals(next.activeModelDisplay, "GPT-4o");
});
