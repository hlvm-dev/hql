import { assertEquals } from "jsr:@std/assert@1";
import {
  expandTextAttachmentReferences,
  filterReferencedAttachments,
  getPastedTextPreviewLabel,
  isAutoAttachableConversationAttachmentPath,
} from "../../../src/hlvm/cli/repl/attachment.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempDir } from "../helpers.ts";

function createTextAttachment(
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
    createTextAttachment(
      1,
      "[Pasted text #1]",
      "[Pasted text #2] should stay literal",
    ),
    createTextAttachment(2, "[Pasted text #2]", "expanded second block"),
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
    createTextAttachment(1, "[Pasted text #1 +2 lines]", "alpha\nbeta\ngamma"),
    createImageAttachment(2),
    createImageAttachment(3),
  ];

  const filtered = filterReferencedAttachments(
    "keep [Pasted text #1 +2 lines] and [Image #3]",
    attachments,
  );

  assertEquals(filtered.map((attachment) => attachment.id), [1, 3]);
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
