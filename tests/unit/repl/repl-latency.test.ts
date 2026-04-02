import {
  assertEquals,
  assertStrictEquals,
} from "jsr:@std/assert";
import { advanceComposerShellState } from "../../../src/hlvm/cli/repl-ink/utils/composer-shell-state.ts";

Deno.test("repl latency: composer shell state stays stable during ordinary typing", () => {
  const initialState = {
    hasDraftInput: false,
    hasSubmitText: false,
    queuedDraftCount: 0,
    queuePreviewRows: 0,
    submitAction: "send-agent" as const,
    version: 0,
  };

  const becameDirty = advanceComposerShellState(initialState, {
    hasDraftInput: true,
    hasSubmitText: true,
    queuedDraftCount: 0,
    queuePreviewRows: 0,
    submitAction: "send-agent" as const,
  });
  assertEquals(becameDirty.version, 1);

  const ordinaryTyping = advanceComposerShellState(becameDirty, {
    hasDraftInput: true,
    hasSubmitText: true,
    queuedDraftCount: 0,
    queuePreviewRows: 0,
    submitAction: "send-agent" as const,
  });
  assertStrictEquals(ordinaryTyping, becameDirty);

  const queueChanged = advanceComposerShellState(ordinaryTyping, {
    hasDraftInput: true,
    hasSubmitText: true,
    queuedDraftCount: 1,
    queuePreviewRows: 2,
    submitAction: "send-agent" as const,
  });
  assertEquals(queueChanged.version, 2);

  const draftCleared = advanceComposerShellState(queueChanged, {
    hasDraftInput: false,
    hasSubmitText: false,
    queuedDraftCount: 0,
    queuePreviewRows: 0,
    submitAction: "send-agent" as const,
  });
  assertEquals(draftCleared.version, 3);
});
