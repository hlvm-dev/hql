import { assertEquals } from "jsr:@std/assert@1";
import {
  createTextAttachment as createReplTextAttachment,
  expandTextAttachmentReferences,
  filterReferencedAttachments,
  findAttachmentReferenceAfterCursor,
  findAttachmentReferenceAtCursor,
  findAttachmentReferenceBeforeCursor,
  getPastedTextPreviewLabel,
  isAutoAttachableConversationAttachmentPath,
  removeAttachmentReferenceAtCursor,
} from "../../../src/hlvm/cli/repl/attachment.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempDir } from "../helpers.ts";

function createFixtureTextAttachment(
  id: number,
  displayName: string,
  content: string,
) {
  return {
    id,
    attachmentId: `att_text_${id}`,
    type: "text" as const,
    displayName,
    content,
    lineCount: 0,
    size: content.length,
    fileName: `pasted-text-${id}.txt`,
    mimeType: "text/plain",
  };
}

function createImageAttachment(id: number) {
  return {
    id,
    attachmentId: `att_image_${id}`,
    type: "image" as const,
    displayName: `[Image #${id}]`,
    path: `/tmp/image-${id}.png`,
    fileName: `image-${id}.png`,
    mimeType: "image/png",
    size: 4,
  };
}

Deno.test("attachment refs: pasted text label matches Claude Code line counting", () => {
  assertEquals(getPastedTextPreviewLabel(1, "alpha"), "[Pasted text #1]");
  assertEquals(
    getPastedTextPreviewLabel(2, "alpha\nbeta\ngamma"),
    "[Pasted text #2 +2 lines]",
  );
});

Deno.test("attachment refs: pasted text expansion is top-level only and leaves image refs intact", () => {
  const attachments = [
    createFixtureTextAttachment(
      1,
      "[Pasted text #1]",
      "[Pasted text #2] should stay literal",
    ),
    createFixtureTextAttachment(2, "[Pasted text #2]", "expanded second block"),
    createImageAttachment(3),
  ];

  const expanded = expandTextAttachmentReferences(
    "before [Pasted text #1] middle [Pasted text #2] after [Image #3]",
    attachments,
  );

  assertEquals(
    expanded,
    "before [Pasted text #2] should stay literal middle expanded second block after [Image #3]",
  );
});

Deno.test("attachment refs: filtering drops orphaned attachments after inline refs are removed", () => {
  const attachments = [
    createFixtureTextAttachment(
      1,
      "[Pasted text #1 +2 lines]",
      "alpha\nbeta\ngamma",
    ),
    createImageAttachment(2),
    createImageAttachment(3),
  ];

  const filtered = filterReferencedAttachments(
    "keep [Pasted text #1 +2 lines] and [Image #3]",
    attachments,
  );

  assertEquals(filtered.map((attachment) => attachment.id), [1, 3]);
});

Deno.test("attachment refs: cursor selects an inline attachment chip", () => {
  const text = "before [Image #2] after";

  assertEquals(findAttachmentReferenceAtCursor(text, 7)?.id, 2);
  assertEquals(findAttachmentReferenceAtCursor(text, 16)?.id, 2);
  assertEquals(findAttachmentReferenceAtCursor(text, 17)?.id, 2);
  assertEquals(findAttachmentReferenceAtCursor(text, 18)?.id, 2);
  assertEquals(findAttachmentReferenceAtCursor(text, 0), null);
});

Deno.test("attachment refs: arrow navigation selects only when crossing a chip", () => {
  const text = "before [Image #2] after";

  assertEquals(findAttachmentReferenceBeforeCursor(text, 18)?.id, 2);
  assertEquals(findAttachmentReferenceBeforeCursor(text, text.length), null);
  assertEquals(findAttachmentReferenceBeforeCursor(text, 7), null);

  assertEquals(findAttachmentReferenceAfterCursor(text, 7)?.id, 2);
  assertEquals(findAttachmentReferenceAfterCursor(text, 8)?.id, 2);
  assertEquals(findAttachmentReferenceAfterCursor(text, 17), null);
  assertEquals(findAttachmentReferenceAfterCursor(text, 6), null);
});

Deno.test("attachment refs: remove selected chip and adjacent spacing", () => {
  assertEquals(
    removeAttachmentReferenceAtCursor("before [Image #2] after", 16),
    {
      id: 2,
      nextCursor: 7,
      nextText: "before after",
    },
  );
  assertEquals(
    removeAttachmentReferenceAtCursor("[Pasted text #1 +2 lines] after", 0),
    {
      id: 1,
      nextCursor: 0,
      nextText: "after",
    },
  );
});

Deno.test("attachment refs: legacy [Text #N] labels still resolve during restore and pruning", () => {
  const attachments = [
    createFixtureTextAttachment(1, "[Text #1]", "legacy text body"),
    createImageAttachment(2),
  ];

  const filtered = filterReferencedAttachments(
    "keep [Text #1] only",
    attachments,
  );
  const expanded = expandTextAttachmentReferences(
    "before [Text #1] after",
    attachments,
  );

  assertEquals(filtered.map((attachment) => attachment.id), [1]);
  assertEquals(expanded, "before legacy text body after");
  assertEquals(filtered[0]?.displayName, "[Text #1]");
});

Deno.test("attachment refs: oversized pasted text returns a clear size error", async () => {
  const oversized = "x".repeat(5 * 1024 * 1024 + 1);
  const result = await createReplTextAttachment(oversized, 1);

  if ("attachmentId" in result) {
    throw new Error("expected oversized pasted text to be rejected");
  }
  assertEquals(result.message, "File too large: 5.0 MB exceeds 5.0 MB limit");
});

Deno.test("attachment refs: auto-attachable path requires an existing media file", async () => {
  await withTempDir(async (dir) => {
    const platform = getPlatform();
    const imagePath = platform.path.join(dir, "photo.png");
    const textPath = platform.path.join(dir, "notes.md");
    const missingImagePath = platform.path.join(dir, "missing.png");

    await platform.fs.writeFile(
      imagePath,
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
    await platform.fs.writeTextFile(textPath, "hello");

    assertEquals(isAutoAttachableConversationAttachmentPath(imagePath), true);
    assertEquals(isAutoAttachableConversationAttachmentPath(textPath), false);
    assertEquals(
      isAutoAttachableConversationAttachmentPath(missingImagePath),
      false,
    );
  });
});
