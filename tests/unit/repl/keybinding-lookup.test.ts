import { assertEquals } from "jsr:@std/assert";
import type { Key } from "ink";
import {
  inspectHandlerKeybinding,
  normalizeKeyInput,
  refreshKeybindingLookup,
} from "../../../src/hlvm/cli/repl-ink/keybindings/index.ts";
import {
  isPureEscKeyEvent,
  shouldInterruptConversationOnEsc,
} from "../../../src/hlvm/cli/repl-ink/components/Input.tsx";
import {
  getCustomKeybindingsSnapshot,
  setCustomKeybindingsSnapshot,
} from "../../../src/hlvm/cli/repl-ink/keybindings/custom-bindings.ts";
import { composerKeybindings } from "../../../src/hlvm/cli/repl-ink/keybindings/definitions/composer.ts";
import { conversationKeybindings } from "../../../src/hlvm/cli/repl-ink/keybindings/definitions/conversation.ts";
import { globalKeybindings } from "../../../src/hlvm/cli/repl-ink/keybindings/definitions/index.ts";
import { HandlerIds } from "../../../src/hlvm/cli/repl-ink/keybindings/handler-registry.ts";
import type { Keybinding } from "../../../src/hlvm/cli/repl-ink/keybindings/types.ts";

function makeKey(overrides: Partial<Key> = {}): Key {
  return {
    backspace: false,
    delete: false,
    downArrow: false,
    escape: false,
    leftArrow: false,
    meta: false,
    return: false,
    rightArrow: false,
    shift: false,
    tab: false,
    upArrow: false,
    ctrl: false,
    ...overrides,
  } as Key;
}

Deno.test("normalizeKeyInput: plain enter, tab, and escape keep their canonical names", () => {
  assertEquals(normalizeKeyInput("\t", makeKey()), "tab");
  assertEquals(normalizeKeyInput("\n", makeKey({ return: true })), "enter");
  assertEquals(normalizeKeyInput("\x1b", makeKey({ escape: true })), "esc");
  assertEquals(normalizeKeyInput("\x1b", makeKey()), "esc");
});

Deno.test("input escape helpers distinguish pure escape from alt-prefixed sequences", () => {
  assertEquals(isPureEscKeyEvent("\x1b", makeKey({ escape: true })), true);
  assertEquals(isPureEscKeyEvent("\x1b", makeKey()), true);
  assertEquals(isPureEscKeyEvent("", makeKey({ escape: true })), true);
  assertEquals(isPureEscKeyEvent("z", makeKey({ escape: true })), false);
  assertEquals(
    shouldInterruptConversationOnEsc("\x1b", makeKey({ escape: true }), {
      composerLanguage: "chat",
      isConversationTaskRunning: true,
      hasInterruptHandler: true,
      hasActiveEscapeSurface: false,
    }),
    true,
  );
  assertEquals(
    shouldInterruptConversationOnEsc("\x1b", makeKey(), {
      composerLanguage: "chat",
      isConversationTaskRunning: true,
      hasInterruptHandler: true,
      hasActiveEscapeSurface: false,
    }),
    true,
  );
  assertEquals(
    shouldInterruptConversationOnEsc("z", makeKey({ escape: true }), {
      composerLanguage: "chat",
      isConversationTaskRunning: true,
      hasInterruptHandler: true,
      hasActiveEscapeSurface: false,
    }),
    false,
  );
  assertEquals(
    shouldInterruptConversationOnEsc("\x1b", makeKey({ escape: true }), {
      composerLanguage: "hql",
      isConversationTaskRunning: true,
      hasInterruptHandler: true,
      hasActiveEscapeSurface: false,
    }),
    false,
  );
  assertEquals(
    shouldInterruptConversationOnEsc("\x1b", makeKey({ escape: true }), {
      composerLanguage: "chat",
      isConversationTaskRunning: true,
      hasInterruptHandler: true,
      hasActiveEscapeSurface: true,
    }),
    false,
  );
});

Deno.test("normalizeKeyInput: ctrl-modified enter and tab keep control-specific identities", () => {
  assertEquals(normalizeKeyInput("\n", makeKey({ ctrl: true })), "ctrl+j");
  assertEquals(normalizeKeyInput("\t", makeKey({ ctrl: true })), "ctrl+i");
});

Deno.test("normalizeKeyInput: alt/meta text sequences normalize consistently", () => {
  assertEquals(normalizeKeyInput("z", makeKey({ escape: true })), "alt+z");
  assertEquals(
    normalizeKeyInput("\r", makeKey({ escape: true, return: true })),
    "alt+enter",
  );
  assertEquals(normalizeKeyInput("\x1b\r", makeKey()), "alt+enter");
  assertEquals(normalizeKeyInput("\x1b[13;3u", makeKey()), "alt+enter");
  assertEquals(normalizeKeyInput("\x1b[13;2u", makeKey()), "alt+enter");
  assertEquals(normalizeKeyInput("\x1b[27;3;13~", makeKey()), "alt+enter");
});

Deno.test("normalizeKeyInput: meta return sequences preserve cmd+enter on mac-style bindings", () => {
  assertEquals(
    normalizeKeyInput("\r", makeKey({ meta: true, return: true })),
    "cmd+enter",
  );
});

Deno.test("normalizeKeyInput: shift-tab remains addressable for mode cycling", () => {
  assertEquals(
    normalizeKeyInput("\t", makeKey({ shift: true, tab: true })),
    "shift+tab",
  );
});

Deno.test("composer keybindings include Shift+Tab mode cycling", () => {
  assertEquals(
    composerKeybindings.some((binding) =>
      binding.display === "Shift+Tab" &&
      binding.label === "Cycle agent mode" &&
      binding.action.type === "HANDLER" &&
      binding.action.id === HandlerIds.COMPOSER_CYCLE_MODE
    ),
    true,
  );
});

Deno.test("global keybindings do not reserve bare question-mark", () => {
  assertEquals(
    globalKeybindings.some((binding) =>
      binding.display === "?" &&
      binding.label === "Show shortcuts"
    ),
    false,
  );
});

Deno.test("global keybindings include Ctrl+T team dashboard handler", () => {
  assertEquals(
    globalKeybindings.some((binding) =>
      binding.display === "Ctrl+T" &&
      binding.label === "Team dashboard" &&
      binding.action.type === "HANDLER" &&
      binding.action.id === HandlerIds.APP_TEAM_DASHBOARD
    ),
    true,
  );
});

Deno.test("conversation keybindings include toggle and source handlers", () => {
  const conversationHandlerIds = new Map(
    conversationKeybindings
      .filter((
        binding,
      ): binding is Keybinding & { action: { type: "HANDLER"; id: string } } =>
        binding.action.type === "HANDLER"
      )
      .map((binding) => [binding.id, binding.action.id] as const),
  );

  assertEquals(
    conversationHandlerIds.get("ctrl+o"),
    HandlerIds.CONVERSATION_TOGGLE_LATEST,
  );
  assertEquals(
    conversationHandlerIds.get("ctrl+y"),
    HandlerIds.CONVERSATION_OPEN_LATEST_SOURCE,
  );
});

Deno.test("global keybindings omit unsupported queue navigation shortcuts", () => {
  const globalIds = new Set(globalKeybindings.map((binding) => binding.id));
  assertEquals(globalIds.has("alt+up-queue"), false);
  assertEquals(globalIds.has("alt+down-queue"), false);
  assertEquals(globalIds.has("alt+backspace-queue"), false);
  assertEquals(globalIds.has("cmd+k"), false);
});

Deno.test("global keybindings use canonical handler IDs", () => {
  const globalHandlerIds = new Map(
    globalKeybindings
      .filter((
        binding,
      ): binding is Keybinding & { action: { type: "HANDLER"; id: string } } =>
        binding.action.type === "HANDLER"
      )
      .map((binding) => [binding.id, binding.action.id] as const),
  );
  assertEquals(globalHandlerIds.get("ctrl+c"), HandlerIds.APP_EXIT);
  assertEquals(globalHandlerIds.get("ctrl+l"), HandlerIds.APP_CLEAR);
  assertEquals(globalHandlerIds.get("ctrl+p"), HandlerIds.APP_PALETTE);
  assertEquals(globalHandlerIds.get("ctrl+b"), HandlerIds.APP_BACKGROUND);
  assertEquals(globalHandlerIds.get("ctrl+t"), HandlerIds.APP_TEAM_DASHBOARD);
});

Deno.test("inspectHandlerKeybinding leaves bare question-mark available for typing", () => {
  const previousBindings = getCustomKeybindingsSnapshot();
  try {
    setCustomKeybindingsSnapshot({});
    refreshKeybindingLookup();

    const result = inspectHandlerKeybinding(
      "?",
      makeKey(),
      { categories: ["Global"] },
    );

    assertEquals(result, { kind: "none" });
  } finally {
    setCustomKeybindingsSnapshot(previousBindings);
    refreshKeybindingLookup();
  }
});

Deno.test("inspectHandlerKeybinding resolves global default handlers by scope", () => {
  const previousBindings = getCustomKeybindingsSnapshot();
  try {
    setCustomKeybindingsSnapshot({});
    refreshKeybindingLookup();

    const result = inspectHandlerKeybinding(
      "t",
      makeKey({ ctrl: true }),
      { categories: ["Global"] },
    );

    assertEquals(result, {
      kind: "handler",
      id: HandlerIds.APP_TEAM_DASHBOARD,
      source: "default",
    });
  } finally {
    setCustomKeybindingsSnapshot(previousBindings);
    refreshKeybindingLookup();
  }
});

Deno.test("inspectHandlerKeybinding lets custom non-global bindings shadow global defaults", () => {
  const previousBindings = getCustomKeybindingsSnapshot();
  try {
    setCustomKeybindingsSnapshot({
      "alt+z": "Ctrl+T",
    });
    refreshKeybindingLookup();

    const globalResult = inspectHandlerKeybinding(
      "t",
      makeKey({ ctrl: true }),
      { categories: ["Global"] },
    );
    const editingResult = inspectHandlerKeybinding(
      "t",
      makeKey({ ctrl: true }),
      { categories: ["Editing"] },
    );

    assertEquals(globalResult, { kind: "shadowed" });
    assertEquals(editingResult, {
      kind: "handler",
      id: HandlerIds.EDIT_UNDO,
      source: "custom",
    });
  } finally {
    setCustomKeybindingsSnapshot(previousBindings);
    refreshKeybindingLookup();
  }
});
