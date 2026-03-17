import { assert, assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import {
  getAttachmentExtractedDir,
  getAttachmentPreparedDir,
  getAttachmentRecordsDir,
} from "../../../src/common/paths.ts";
import {
  getAttachmentRecord,
  materializeAttachment,
  materializeConversationAttachment,
  materializeConversationAttachments,
  readAttachmentContent,
  registerAttachmentFromPath,
  registerTextAttachment,
  registerUploadedAttachment,
} from "../../../src/hlvm/attachments/service.ts";
import { AttachmentServiceError } from "../../../src/hlvm/attachments/types.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempDir, withTempHlvmDir } from "../helpers.ts";
import JSZip from "jszip";
import * as XLSX from "xlsx";

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

async function createDocxBytes(lines: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.folder("_rels")?.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  const paragraphs = lines.map((line) =>
    `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`
  ).join("");
  zip.folder("word")?.file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphs}</w:body>
</w:document>`,
  );
  return await zip.generateAsync({ type: "uint8array" });
}

async function createPptxBytes(text: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`,
  );
  zip.folder("_rels")?.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
  );
  zip.folder("ppt")?.file(
    "presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
</p:presentation>`,
  );
  zip.folder("ppt/_rels")?.file(
    "presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`,
  );
  zip.folder("ppt/slides")?.file(
    "slide1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`,
  );
  return await zip.generateAsync({ type: "uint8array" });
}

function createXlsxBytes(rows: Array<Array<string | number>>): Uint8Array {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function createRtfBytes(text: string): Uint8Array {
  return new TextEncoder().encode(`{\\rtf1\\ansi ${text.replace(/\n/g, "\\par ")}}`);
}

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

    const materialized = await materializeAttachment(record.id, "anthropic");
    const loaded = await getAttachmentRecord(record.id);

    assertEquals(record.mimeType, "application/pdf");
    assertEquals(record.kind, "pdf");
    assertEquals(record.metadata, { pages: 1 });
    assertExists(loaded);
    assertEquals(loaded.metadata, { pages: 1 });
    assert(materialized.prepared.data.length > 0);
    assertEquals(materialized.prepared.mimeType, "application/pdf");

    const preparedPath = platform.path.join(
      getAttachmentPreparedDir(),
      "anthropic",
      `${record.id}.json`,
    );
    assert(await platform.fs.exists(preparedPath));
  });
});

Deno.test("attachment service reads raw attachment content through the canonical blob store", async () => {
  await withTempHlvmDir(async () => {
    const record = await registerUploadedAttachment({
      fileName: "pixel.png",
      bytes: ONE_BY_ONE_PNG,
      mimeType: "image/png",
    });

    const loaded = await readAttachmentContent(record.id);

    assertEquals(loaded.record.id, record.id);
    assertEquals(loaded.record.mimeType, "image/png");
    assertEquals(loaded.bytes, ONE_BY_ONE_PNG);
    assertExists(loaded.record.lastAccessedAt);
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
    const firstMaterialized = await materializeAttachment(first.id, "default");

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
    const refreshedMaterialized = await materializeAttachment(promoted.id, "default");
    const loaded = await getAttachmentRecord(promoted.id);

    assertEquals(firstMaterialized.prepared.fileName, "attachment.bin");
    assertEquals(firstMaterialized.prepared.mimeType, "application/octet-stream");
    assertEquals(firstMaterialized.prepared.kind, "file");
    assertEquals(refreshedMaterialized.prepared.fileName, "notes.txt");
    assertEquals(refreshedMaterialized.prepared.mimeType, "text/plain");
    assertEquals(refreshedMaterialized.prepared.kind, "text");
    assertExists(loaded?.lastAccessedAt);
    assert(loaded.lastAccessedAt !== "2000-01-01T00:00:00.000Z");
  });
});

Deno.test("attachment service materializes mixed conversation attachments into runtime payloads", async () => {
  await withTempHlvmDir(async () => {
    const image = await registerUploadedAttachment({
      fileName: "pixel.png",
      bytes: ONE_BY_ONE_PNG,
      mimeType: "image/png",
    });
    const pdf = await registerUploadedAttachment({
      fileName: "doc.pdf",
      bytes: SINGLE_PAGE_PDF,
      mimeType: "application/pdf",
    });
    const text = await registerTextAttachment(
      "Attachment-backed text body",
      "notes.txt",
    );

    const payloads = await materializeConversationAttachments(
      [image.id, pdf.id, text.id],
      "default",
    );

    assertEquals(
      payloads.map((payload) => `${payload.mode}:${payload.mimeType}`),
      [
        "binary:image/png",
        "binary:application/pdf",
        "text:text/plain",
      ],
    );
    const textPayload = payloads[2];
    assertEquals(textPayload?.mode, "text");
    assertEquals(
      textPayload?.mode === "text" ? textPayload.text : undefined,
      "Attachment-backed text body",
    );
  });
});

Deno.test("attachment service extracts office-family attachments and caches extracted text by profile", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const docx = await registerUploadedAttachment({
      fileName: "report.docx",
      bytes: await createDocxBytes(["Hello DOCX", "Second line"]),
    });
    const xlsx = await registerUploadedAttachment({
      fileName: "sheet.xlsx",
      bytes: createXlsxBytes([["Name", "Value"], ["alpha", 42]]),
    });
    const pptx = await registerUploadedAttachment({
      fileName: "slides.pptx",
      bytes: await createPptxBytes("Hello PPTX"),
    });
    const rtf = await registerUploadedAttachment({
      fileName: "notes.rtf",
      bytes: createRtfBytes("Hello RTF\\par Second line"),
      mimeType: "application/rtf",
    });

    const payloads = await materializeConversationAttachments([
      docx.id,
      xlsx.id,
      pptx.id,
      rtf.id,
    ]);

    assertEquals(payloads.map((payload) => payload.mode), [
      "text",
      "text",
      "text",
      "text",
    ]);
    assertEquals(payloads[0]?.mode === "text" ? payloads[0].text : "", "Hello DOCX\nSecond line");
    assertEquals(payloads[1]?.mode === "text" ? payloads[1].text : "", "Name\nValue\nalpha\n42");
    assertEquals(payloads[2]?.mode === "text" ? payloads[2].text : "", "Hello PPTX");
    assertEquals(
      payloads[3]?.mode === "text" &&
        payloads[3].text.includes("Hello RTF") &&
        payloads[3].text.includes("Second line"),
      true,
    );

    const cachePath = platform.path.join(
      getAttachmentExtractedDir(),
      "default",
      `${docx.id}.broad-v1.json`,
    );
    assert(await platform.fs.exists(cachePath));
  });
});

Deno.test("attachment service falls back to extracted PDF text when the model does not support native PDF", async () => {
  await withTempHlvmDir(async () => {
    const pdf = await registerUploadedAttachment({
      fileName: "doc.pdf",
      bytes: SINGLE_PAGE_PDF,
      mimeType: "application/pdf",
    });

    const payload = await materializeConversationAttachment(pdf.id, {
      preferTextKinds: ["pdf"],
    });

    assertEquals(payload.mode, "text");
    assertEquals(payload.mimeType, "application/pdf");
    assertEquals(payload.conversationKind, "text");
    assertEquals(payload.mode === "text", true);
    if (payload.mode === "text") {
      assertEquals(payload.text.length > 0, true);
    }
  });
});

Deno.test("attachment service rejects opaque binary files at ingest", async () => {
  await withTempHlvmDir(async () => {
    await assertRejects(
      () =>
        registerUploadedAttachment({
          fileName: "blob.bin",
          bytes: new Uint8Array([0x00, 0xff, 0x81, 0x00]),
          mimeType: "application/octet-stream",
        }),
      AttachmentServiceError,
      "runtime cannot extract readable text",
    );
  });
});
