import { assertEquals } from "jsr:@std/assert@1";
import { buildQueuePreviewLines } from "../../../src/hlvm/cli/repl-ink/components/QueuePreview.tsx";
import {
  createConversationComposerDraft,
  enqueueConversationDraft,
  getConversationQueueEditBinding,
  mergeConversationDraftsForInterrupt,
  popLastQueuedConversationDraft,
  renumberConversationDraftAttachments,
  shiftQueuedConversationDraft,
  trimConversationDraftText,
} from "../../../src/hlvm/cli/repl-ink/utils/conversation-queue.ts";

function imageAttachment(id: number) {
  return {
    id,
    attachmentId: `att_image_${id}`,
    type: "image" as const,
    displayName: `[Image #${id}]`,
    path: `/tmp/image-${id}.png`,
    fileName: `image-${id}.png`,
    mimeType: "image/png",
    size: 3,
  };
}

function textAttachment(id: number, lineCount: number) {
  return {
    id,
    attachmentId: `att_text_${id}`,
    type: "text" as const,
    displayName: `[Pasted text #${id} +${lineCount} lines]`,
    content: "alpha\nbeta\ngamma",
    fileName: `pasted-${id}.txt`,
    mimeType: "text/plain",
    lineCount,
    size: 16,
  };
}

Deno.test("getConversationQueueEditBinding matches Codex terminal mapping", () => {
  assertEquals(
    getConversationQueueEditBinding({
      get: (key: string) =>
        key === "TERM_PROGRAM" ? "Apple_Terminal" : undefined,
    }),
    "shift-left",
  );
  assertEquals(
    getConversationQueueEditBinding({
      get: (key: string) => key === "TERM_PROGRAM" ? "WarpTerminal" : undefined,
    }),
    "shift-left",
  );
  assertEquals(
    getConversationQueueEditBinding({
      get: (key: string) => key === "TERM_PROGRAM" ? "vscode" : undefined,
    }),
    "shift-left",
  );
  assertEquals(
    getConversationQueueEditBinding({
      get: (key: string) => key === "TERM_PROGRAM" ? "WezTerm" : undefined,
    }),
    "alt-up",
  );
});

Deno.test("renumberConversationDraftAttachments rewrites placeholders and attachment ids", () => {
  const draft = createConversationComposerDraft(
    "[Image #1] and [Pasted text #2 +3 lines]",
    [imageAttachment(1), textAttachment(2, 3)],
    37,
  );

  const result = renumberConversationDraftAttachments(draft, 4);

  assertEquals(
    result.draft.text,
    "[Image #4] and [Pasted text #5 +3 lines]",
  );
  assertEquals(
    result.draft.attachments.map((attachment) => attachment.displayName),
    ["[Image #4]", "[Pasted text #5 +3 lines]"],
  );
  assertEquals(result.draft.cursorOffset, 37);
  assertEquals(result.nextAttachmentId, 6);
});

Deno.test("trimConversationDraftText keeps the cursor aligned with trimmed text", () => {
  const trimmed = trimConversationDraftText("  hello world  ", 9);

  assertEquals(trimmed, {
    text: "hello world",
    cursorOffset: 7,
  });
});

Deno.test("queued draft helpers preserve FIFO send order and LIFO edit recall", () => {
  const first = createConversationComposerDraft("first");
  const second = createConversationComposerDraft("second");
  const queued = enqueueConversationDraft(
    enqueueConversationDraft([], first),
    second,
  );

  const shifted = shiftQueuedConversationDraft(queued);
  assertEquals(shifted.draft?.text, "first");
  assertEquals(shifted.remaining.map((draft) => draft.text), ["second"]);

  const popped = popLastQueuedConversationDraft(queued);
  assertEquals(popped.draft?.text, "second");
  assertEquals(popped.remaining.map((draft) => draft.text), ["first"]);
});

Deno.test("mergeConversationDraftsForInterrupt restores queued drafts before current draft", () => {
  const queued = [
    createConversationComposerDraft(
      "[Image #1] first",
      [imageAttachment(1)],
      5,
    ),
    createConversationComposerDraft(
      "second [Pasted text #1 +3 lines]",
      [textAttachment(1, 3)],
      6,
    ),
  ];
  const current = createConversationComposerDraft(
    "[Image #1] current draft",
    [imageAttachment(1)],
    10,
  );

  const merged = mergeConversationDraftsForInterrupt(queued, current);

  assertEquals(
    merged?.text,
    "[Image #1] first\nsecond [Pasted text #2 +3 lines]\n[Image #3] current draft",
  );
  assertEquals(
    merged?.attachments.map((attachment) => attachment.displayName),
    ["[Image #1]", "[Pasted text #2 +3 lines]", "[Image #3]"],
  );
  assertEquals(
    merged?.cursorOffset,
    "[Image #1] first\nsecond [Pasted text #2 +3 lines]\n[Image #3] current draft"
      .length,
  );
});

Deno.test("buildQueuePreviewLines renders codex-style header, previews, and hint", () => {
  const lines = buildQueuePreviewLines(
    [
      createConversationComposerDraft("first queued"),
      createConversationComposerDraft("second queued"),
      createConversationComposerDraft("third queued"),
      createConversationComposerDraft("fourth queued"),
    ],
    "Alt+\u2191",
  );

  assertEquals(lines.map((line) => line.text), [
    "Queued",
    " 1. first queued",
    " 2. second queued",
    " 3. third queued",
    "\u2026",
    "Alt+\u2191 edit last queued message",
  ]);
  assertEquals(lines[0]?.chip, true);
});
