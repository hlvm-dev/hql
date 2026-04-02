import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import {
  getHistoryPath,
  getHistoryPasteStoreDir,
} from "../../../src/common/paths.ts";
import { getLegacyHistoryPath } from "../../../src/common/legacy-migration.ts";
import { registerUploadedAttachment } from "../../../src/hlvm/attachments/service.ts";
import {
  createTextAttachment,
  type Attachment,
} from "../../../src/hlvm/cli/repl/attachment.ts";
import { HistoryStorage } from "../../../src/hlvm/cli/repl/history-storage.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempHlvmDir } from "../helpers.ts";

Deno.test("history storage reads legacy entries without attachments", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const legacyDir = await platform.fs.makeTempDir({ prefix: "hlvm-legacy-" });
    const previousHqlDir = platform.env.get("HQL_DIR");
    platform.env.set("HQL_DIR", legacyDir);
    try {
      const legacyHistoryPath = getLegacyHistoryPath();
      await platform.fs.mkdir(platform.path.dirname(legacyHistoryPath), {
        recursive: true,
      });
      await platform.fs.writeTextFile(
        legacyHistoryPath,
        `${JSON.stringify({ ts: 1, cmd: "hello", source: "conversation", language: "chat" })}\n`,
      );

      const storage = new HistoryStorage();
      await storage.init();

      const entries = storage.getEntries();
      assertEquals(entries.length, 1);
      assertEquals(entries[0]?.ts, 1);
      assertEquals(entries[0]?.cmd, "hello");
      assertEquals(entries[0]?.source, "conversation");
      assertEquals(entries[0]?.language, "chat");
      assertEquals(entries[0]?.attachments, undefined);
    } finally {
      if (previousHqlDir === undefined) {
        platform.env.delete("HQL_DIR");
      } else {
        platform.env.set("HQL_DIR", previousHqlDir);
      }
      await platform.fs.remove(legacyDir, { recursive: true });
    }
  });
});

Deno.test("history storage round-trips attachment-backed entries with inline and hashed pasted text", async () => {
  await withTempHlvmDir(async () => {
    const smallText = await createTextAttachment("hello world", 1);
    const largeContent = Array.from({ length: 220 }, (_, index) =>
      `line-${index}`
    ).join("\n");
    const largeText = await createTextAttachment(largeContent, 2);
    assert("attachmentId" in smallText);
    assert("attachmentId" in largeText);

    const imageRecord = await registerUploadedAttachment({
      fileName: "example.png",
      mimeType: "image/png",
      bytes: Uint8Array.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
      ]),
    });
    const binaryAttachment: Attachment = {
      id: 3,
      attachmentId: imageRecord.id,
      type: "image",
      displayName: "[Image #3]",
      path: "/tmp/example.png",
      fileName: imageRecord.fileName,
      mimeType: imageRecord.mimeType,
      size: imageRecord.size,
      metadata: imageRecord.metadata,
    };

    const storage = new HistoryStorage({ saveDebounceMs: 0 });
    await storage.init();
    storage.append(
      `${smallText.displayName} ${largeText.displayName} ${binaryAttachment.displayName}`,
      {
        source: "conversation",
        language: "chat",
        attachments: [smallText, largeText, binaryAttachment],
      },
    );
    await storage.flush();

    const rawHistory = await getPlatform().fs.readTextFile(getHistoryPath());
    const persistedEntry = JSON.parse(rawHistory.trim()) as {
      attachments?: Array<{ content?: string; contentHash?: string }>;
    };
    assertEquals(persistedEntry.attachments?.[0]?.content, "hello world");
    assertExists(persistedEntry.attachments?.[1]?.contentHash);
    assertEquals(persistedEntry.attachments?.[1]?.content, undefined);

    const pasteStorePath = getPlatform().path.join(
      getHistoryPasteStoreDir(),
      `${persistedEntry.attachments?.[1]?.contentHash}.txt`,
    );
    assertEquals(
      await getPlatform().fs.readTextFile(pasteStorePath),
      largeContent,
    );

    const reloaded = new HistoryStorage();
    await reloaded.init();
    const entry = reloaded.getEntries()[0];
    assertExists(entry);
    assertEquals(entry?.cmd, `${smallText.displayName} ${largeText.displayName} ${binaryAttachment.displayName}`);
    assertEquals(entry?.attachments?.length, 3);
    assertEquals(
      entry?.attachments?.map((attachment) => attachment.displayName),
      [smallText.displayName, largeText.displayName, binaryAttachment.displayName],
    );
    const restoredLargeText = entry?.attachments?.[1];
    assertExists(restoredLargeText);
    if (restoredLargeText && "content" in restoredLargeText) {
      assertEquals(restoredLargeText.content, largeContent);
    }
    const restoredBinary = entry?.attachments?.[2];
    assertExists(restoredBinary);
    if (restoredBinary && !("content" in restoredBinary)) {
      assertEquals(restoredBinary.attachmentId, imageRecord.id);
      assertEquals(restoredBinary.path, "/tmp/example.png");
    }
  });
});
