import {
  assertEquals,
  assertStrictEquals,
} from "jsr:@std/assert";
import { advanceComposerShellState } from "../../../src/hlvm/cli/repl-ink/utils/composer-shell-state.ts";

Deno.test("repl latency: composer shell state stays stable during ordinary typing", () => {
  const initialState = {
    hasDraftInput: false,
    queuedDraftCount: 0,
    queuePreviewRows: 0,
    version: 0,
  };

  const becameDirty = advanceComposerShellState(initialState, {
    hasDraftInput: true,
    queuedDraftCount: 0,
    queuePreviewRows: 0,
  });
  assertEquals(becameDirty.version, 1);

  const ordinaryTyping = advanceComposerShellState(becameDirty, {
    hasDraftInput: true,
    queuedDraftCount: 0,
    queuePreviewRows: 0,
  });
  assertStrictEquals(ordinaryTyping, becameDirty);

  const queueChanged = advanceComposerShellState(ordinaryTyping, {
    hasDraftInput: true,
    queuedDraftCount: 1,
    queuePreviewRows: 2,
  });
  assertEquals(queueChanged.version, 2);

  const draftCleared = advanceComposerShellState(queueChanged, {
    hasDraftInput: false,
    queuedDraftCount: 0,
    queuePreviewRows: 0,
  });
  assertEquals(draftCleared.version, 3);
});
