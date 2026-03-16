import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import {
  getAttachmentPreparedDir,
  getAttachmentRecordsDir,
} from "../../../src/common/paths.ts";
import {
  getAttachmentRecord,
  prepareAttachment,
  registerAttachmentFromPath,
  registerUploadedAttachment,
} from "../../../src/hlvm/attachments/service.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempDir, withTempHlvmDir } from "../helpers.ts";

function bytesFromBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

const ONE_BY_ONE_PNG = bytesFromBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Bt1kAAAAASUVORK5CYII=",
);

const SINGLE_PAGE_PDF = new TextEncoder().encode(
  `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF`,
);

Deno.test("attachment service registers, deduplicates, and records image metadata", async () => {
  await withTempHlvmDir(async () => {
    await withTempDir(async (tempDir) => {
      const platform = getPlatform();
      const firstPath = platform.path.join(tempDir, "pixel-a.png");
      const secondPath = platform.path.join(tempDir, "pixel-b.png");

      await platform.fs.writeFile(firstPath, ONE_BY_ONE_PNG);
      await platform.fs.writeFile(secondPath, ONE_BY_ONE_PNG);

      const first = await registerAttachmentFromPath(firstPath);
      const second = await registerAttachmentFromPath(secondPath);
      const loaded = await getAttachmentRecord(first.id);

      assertEquals(second.id, first.id);
      assertExists(loaded);
      assertEquals(loaded.mimeType, "image/png");
      assertEquals(loaded.kind, "image");
      assertEquals(loaded.metadata, { width: 1, height: 1 });

      const recordPath = platform.path.join(
        getAttachmentRecordsDir(),
        `${first.id}.json`,
      );
      assert(await platform.fs.exists(recordPath));
    });
  });
});

Deno.test("attachment service uploads documents, extracts metadata, and caches prepared payloads by profile", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const record = await registerUploadedAttachment({
      fileName: "doc.pdf",
      bytes: SINGLE_PAGE_PDF,
      mimeType: "application/pdf",
      sourcePath: "/tmp/doc.pdf",
    });

    const prepared = await prepareAttachment(record.id, "anthropic");
    const loaded = await getAttachmentRecord(record.id);

    assertEquals(record.mimeType, "application/pdf");
    assertEquals(record.kind, "pdf");
    assertEquals(record.metadata, { pages: 1 });
    assertExists(loaded);
    assertEquals(loaded.metadata, { pages: 1 });
    assert(prepared.data.length > 0);
    assertEquals(prepared.mimeType, "application/pdf");

    const preparedPath = platform.path.join(
      getAttachmentPreparedDir(),
      "anthropic",
      `${record.id}.json`,
    );
    assert(await platform.fs.exists(preparedPath));
  });
});

Deno.test("attachment service promotes deduped generic files to a normalized filename and richer mime kind", async () => {
  await withTempHlvmDir(async () => {
    const bytes = new TextEncoder().encode("hello attachment\n");

    const first = await registerUploadedAttachment({
      fileName: "attachment.bin",
      bytes,
    });
    const second = await registerUploadedAttachment({
      fileName: "notes.txt",
      bytes,
    });

    assertEquals(first.id, second.id);
    assertEquals(second.fileName, "notes.txt");
    assertEquals(second.mimeType, "text/plain");
    assertEquals(second.kind, "text");

    const loaded = await getAttachmentRecord(second.id);
    assertExists(loaded);
    assertEquals(loaded.fileName, "notes.txt");
    assertEquals(loaded.mimeType, "text/plain");
    assertEquals(loaded.kind, "text");
  });
});

Deno.test("attachment service refreshes stale prepared payload metadata after a deduped record is promoted", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const bytes = new TextEncoder().encode("hello attachment\n");

    const first = await registerUploadedAttachment({
      fileName: "attachment.bin",
      bytes,
    });
    const firstPrepared = await prepareAttachment(first.id, "default");

    const recordPath = platform.path.join(
      getAttachmentRecordsDir(),
      `${first.id}.json`,
    );
    const rawRecord = JSON.parse(
      await platform.fs.readTextFile(recordPath),
    ) as Record<string, unknown>;
    rawRecord.lastAccessedAt = "2000-01-01T00:00:00.000Z";
    await platform.fs.writeTextFile(recordPath, JSON.stringify(rawRecord));

    const promoted = await registerUploadedAttachment({
      fileName: "notes.txt",
      bytes,
    });
    const refreshedPrepared = await prepareAttachment(promoted.id, "default");
    const loaded = await getAttachmentRecord(promoted.id);

    assertEquals(firstPrepared.fileName, "attachment.bin");
    assertEquals(firstPrepared.mimeType, "application/octet-stream");
    assertEquals(firstPrepared.kind, "file");
    assertEquals(refreshedPrepared.fileName, "notes.txt");
    assertEquals(refreshedPrepared.mimeType, "text/plain");
    assertEquals(refreshedPrepared.kind, "text");
    assertExists(loaded?.lastAccessedAt);
    assert(loaded.lastAccessedAt !== "2000-01-01T00:00:00.000Z");
  });
});
