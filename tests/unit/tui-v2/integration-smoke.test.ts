/**
 * TUI v2 Integration Smoke Tests
 *
 * Tests the data flow: input dispatch → conversation state → item output.
 * No rendering — just logic.
 */

import { assertEquals } from "https://deno.land/std/assert/mod.ts";
import { classifyInput } from "../../../src/hlvm/tui-v2/input/InputDispatch.ts";
import { appReducer } from "../../../src/hlvm/tui-v2/state/reducer.ts";
import { initialAppState } from "../../../src/hlvm/tui-v2/state/types.ts";
import { resolveKeystroke } from "../../../src/hlvm/tui-v2/keybindings/resolver.ts";
import { DEFAULT_BINDINGS } from "../../../src/hlvm/tui-v2/keybindings/defaults.ts";

// -- Input dispatch + state round trips --

Deno.test("integration: chat mode conversation flow", () => {
  const state = initialAppState();
  assertEquals(state.inputMode, "chat");

  // User types a natural language query
  const classification = classifyInput("explain how maps work", "chat");
  assertEquals(classification.kind, "conversation");
});

Deno.test("integration: parenthesis rule in chat mode", () => {
  const classification = classifyInput("(+ 1 2)", "chat");
  assertEquals(classification.kind, "hql_eval");
});

Deno.test("integration: code mode toggle via state reducer", () => {
  let state = initialAppState();
  assertEquals(state.inputMode, "chat");

  state = appReducer(state, { type: "toggle_mode" });
  assertEquals(state.inputMode, "code");

  // In code mode, non-paren input is JS
  const classification = classifyInput("let x = 5", state.inputMode);
  assertEquals(classification.kind, "js_eval");

  // Toggle back
  state = appReducer(state, { type: "toggle_mode" });
  assertEquals(state.inputMode, "chat");

  // Same input in chat mode is conversation
  const chatClassification = classifyInput("let x = 5", state.inputMode);
  assertEquals(chatClassification.kind, "conversation");
});

Deno.test("integration: keybinding resolve + state dispatch", () => {
  // Shift+Tab resolves to toggle-mode
  const action = resolveKeystroke(
    { key: "tab", ctrl: false, shift: true, alt: false },
    ["chat", "global"],
    DEFAULT_BINDINGS,
  );
  assertEquals(action, "toggle-mode");

  // Applying toggle_mode action
  const state = appReducer(initialAppState(), { type: "toggle_mode" });
  assertEquals(state.inputMode, "code");
});

Deno.test("integration: input → set_input → classify round trip", () => {
  let state = initialAppState();

  // Simulate typing "(+ 1 2)"
  state = appReducer(state, { type: "set_input", text: "(+ 1 2)", cursor: 7 });
  assertEquals(state.inputText, "(+ 1 2)");

  // Classify what was typed
  const classification = classifyInput(state.inputText, state.inputMode);
  assertEquals(classification.kind, "hql_eval");

  // After submit, input clears
  state = appReducer(state, { type: "set_input", text: "", cursor: 0 });
  assertEquals(state.inputText, "");
});

Deno.test("integration: loading state during conversation", () => {
  let state = initialAppState();

  // Start loading
  state = appReducer(state, { type: "set_loading", loading: true });
  assertEquals(state.isLoading, true);

  // Finish loading
  state = appReducer(state, { type: "set_loading", loading: false });
  assertEquals(state.isLoading, false);
});
