import { assert, assertEquals } from "jsr:@std/assert";
import {
  closeAction,
  dropdownReducer,
  getSelectedItem,
  isActive,
  openAction,
  selectIndexAction,
  selectNextAction,
  selectPrevAction,
  setItemsAction,
  setLoadingAction,
  toggleDocPanelAction,
} from "../../../../src/hlvm/cli/repl-ink/completion/state.ts";
import type {
  ApplyContext,
  ApplyResult,
  CompletionAction,
  CompletionItem,
  CompletionType,
  DropdownState,
  ItemRenderSpec,
} from "../../../../src/hlvm/cli/repl-ink/completion/types.ts";
import { INITIAL_DROPDOWN_STATE, TYPE_ICONS } from "../../../../src/hlvm/cli/repl-ink/completion/types.ts";

function createMockItem(
  id: string,
  label: string,
  type: CompletionType,
  score: number,
): CompletionItem {
  return {
    id,
    label,
    type,
    score,
    availableActions: ["SELECT"],
    applyAction: (_action: CompletionAction, context: ApplyContext): ApplyResult => ({
      text: context.text.slice(0, context.anchorPosition) +
        label +
        context.text.slice(context.cursorPosition),
      cursorPosition: context.anchorPosition + label.length,
      closeDropdown: true,
    }),
    getRenderSpec: (): ItemRenderSpec => ({
      icon: TYPE_ICONS[type],
      label,
      truncate: "end",
      maxWidth: 40,
    }),
  };
}

const items: CompletionItem[] = [
  createMockItem("1", "def", "keyword", 100),
  createMockItem("2", "defn", "keyword", 90),
  createMockItem("3", "default", "function", 80),
];

function createOpenState(overrides: Partial<DropdownState> = {}): DropdownState {
  return {
    isOpen: true,
    items,
    selectedIndex: 0,
    anchorPosition: 0,
    providerId: "symbol",
    isLoading: false,
    showDocPanel: false,
    originalText: "de",
    originalCursor: 2,
    ...overrides,
  };
}

Deno.test("completion state: open initializes session metadata and selection", () => {
  const open = dropdownReducer(
    INITIAL_DROPDOWN_STATE,
    openAction(items, 5, "file", "@de", 3),
  );
  const empty = dropdownReducer(
    INITIAL_DROPDOWN_STATE,
    openAction([], 0, "symbol", "", 0),
  );

  assertEquals(open.isOpen, true);
  assertEquals(open.items, items);
  assertEquals(open.selectedIndex, 0);
  assertEquals(open.anchorPosition, 5);
  assertEquals(open.providerId, "file");
  assertEquals(open.originalText, "@de");
  assertEquals(open.originalCursor, 3);
  assertEquals(open.isLoading, false);
  assertEquals(empty.selectedIndex, -1);
});

Deno.test("completion state: close resets ephemeral state and preserves doc toggle", () => {
  const state = createOpenState({
    selectedIndex: 2,
    anchorPosition: 10,
    isLoading: true,
    showDocPanel: true,
  });

  const closed = dropdownReducer(state, closeAction());

  assertEquals(closed.isOpen, false);
  assertEquals(closed.items, []);
  assertEquals(closed.selectedIndex, 0);
  assertEquals(closed.showDocPanel, true);
});

Deno.test("completion state: set items preserves valid selection and closes on empty", () => {
  const preserved = dropdownReducer(
    createOpenState({ selectedIndex: 1, isLoading: true }),
    setItemsAction(items.slice(0, 2)),
  );
  const reset = dropdownReducer(
    createOpenState({ selectedIndex: 2, isLoading: true }),
    setItemsAction(items.slice(0, 2)),
  );
  const closed = dropdownReducer(
    createOpenState({ showDocPanel: true }),
    setItemsAction([]),
  );

  assertEquals(preserved.selectedIndex, 1);
  assertEquals(preserved.isLoading, false);
  assertEquals(reset.selectedIndex, 0);
  assertEquals(closed.isOpen, false);
  assertEquals(closed.showDocPanel, true);
});

Deno.test("completion state: navigation wraps and ignores empty lists", () => {
  const nextWrapped = dropdownReducer(
    createOpenState({ selectedIndex: 2 }),
    selectNextAction(),
  );
  const prevWrapped = dropdownReducer(
    createOpenState({ selectedIndex: 0 }),
    selectPrevAction(),
  );
  const empty = dropdownReducer(
    createOpenState({ items: [], selectedIndex: -1 }),
    selectNextAction(),
  );

  assertEquals(nextWrapped.selectedIndex, 0);
  assertEquals(prevWrapped.selectedIndex, 2);
  assertEquals(empty.selectedIndex, -1);
});

Deno.test("completion state: select index enforces bounds", () => {
  const selected = dropdownReducer(createOpenState(), selectIndexAction(2));
  const negative = dropdownReducer(createOpenState({ selectedIndex: 1 }), selectIndexAction(-1));
  const outOfBounds = dropdownReducer(createOpenState({ selectedIndex: 1 }), selectIndexAction(10));

  assertEquals(selected.selectedIndex, 2);
  assertEquals(negative.selectedIndex, 1);
  assertEquals(outOfBounds.selectedIndex, 1);
});

Deno.test("completion state: loading and doc panel toggles are independent", () => {
  const loading = dropdownReducer(INITIAL_DROPDOWN_STATE, setLoadingAction(true));
  const toggled = dropdownReducer(
    createOpenState({ selectedIndex: 2, showDocPanel: false }),
    toggleDocPanelAction(),
  );

  assertEquals(loading.isLoading, true);
  assertEquals(toggled.showDocPanel, true);
  assertEquals(toggled.selectedIndex, 2);
  assertEquals(toggled.items, items);
  assertEquals(toggled.isOpen, true);
});

Deno.test("completion state: getSelectedItem returns current item or null", () => {
  assertEquals(getSelectedItem(createOpenState({ selectedIndex: 1 }))?.label, "defn");
  assertEquals(getSelectedItem(createOpenState({ selectedIndex: -1 })), null);
});

Deno.test("completion state: isActive reflects open items or loading state", () => {
  assert(isActive(createOpenState()));
  assert(isActive(createOpenState({ items: [], selectedIndex: -1, isLoading: true })));
  assert(!isActive(INITIAL_DROPDOWN_STATE));
  assert(!isActive(createOpenState({ items: [], selectedIndex: -1, isLoading: false })));
});
