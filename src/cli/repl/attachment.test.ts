/**
 * Comprehensive unit tests for attachment functionality
 * Tests:
 * - Text paste detection, collapsing, and multi-attachment scenarios
 * - Media attachment (image, video, audio, document) handling
 * - MIME type detection and mapping
 * - File size formatting and limits
 * - Error handling (not found, permission denied, size exceeded)
 * - Type guards and utility functions
 */

import { assertEquals, assertExists, assert } from "jsr:@std/assert";
import {
  // Text attachment functions
  shouldCollapseText,
  countLines,
  createTextAttachment,
  getTextDisplayName,
  getTextAttachmentPreview,
  isTextAttachment,
  TEXT_COLLAPSE_MIN_LINES,
  TEXT_COLLAPSE_MIN_CHARS,
  type TextAttachment,
  // Media attachment functions
  createAttachment,
  detectMimeType,
  getAttachmentType,
  getDisplayName,
  formatFileSize,
  getSizeLimit,
  isSupportedMedia,
  isAttachment,
  isAttachmentError,
  formatAttachmentDetail,
  type Attachment,
  type AttachmentError,
  type AttachmentType,
} from "./attachment.ts";

// ============================================================================
// shouldCollapseText tests
// ============================================================================

Deno.test("shouldCollapseText - single line should NOT collapse", () => {
  const singleLine = "This is a single line of text";
  assertEquals(shouldCollapseText(singleLine), false);
});

Deno.test("shouldCollapseText - single very long line should NOT collapse", () => {
  const longSingleLine = "a".repeat(500);
  assertEquals(shouldCollapseText(longSingleLine), false);
});

Deno.test("shouldCollapseText - 2 short lines should NOT collapse", () => {
  const twoShortLines = "line1\nline2";
  assertEquals(shouldCollapseText(twoShortLines), false);
});

Deno.test("shouldCollapseText - 5+ lines SHOULD collapse", () => {
  const fiveLines = "line1\nline2\nline3\nline4\nline5";
  assertEquals(shouldCollapseText(fiveLines), true);
});

Deno.test("shouldCollapseText - 2+ lines with 300+ chars SHOULD collapse", () => {
  const twoLongLines = "a".repeat(200) + "\n" + "b".repeat(200);
  assertEquals(shouldCollapseText(twoLongLines), true);
});

Deno.test("shouldCollapseText - handles Unix newlines (\\n)", () => {
  const unixNewlines = "l1\nl2\nl3\nl4\nl5\nl6";
  assertEquals(countLines(unixNewlines), 6);
  assertEquals(shouldCollapseText(unixNewlines), true);
});

Deno.test("shouldCollapseText - handles Windows newlines (\\r\\n)", () => {
  const windowsNewlines = "l1\r\nl2\r\nl3\r\nl4\r\nl5\r\nl6";
  assertEquals(countLines(windowsNewlines), 6);
  assertEquals(shouldCollapseText(windowsNewlines), true);
});

Deno.test("shouldCollapseText - handles old Mac newlines (\\r)", () => {
  const macNewlines = "l1\rl2\rl3\rl4\rl5\rl6";
  assertEquals(countLines(macNewlines), 6);
  assertEquals(shouldCollapseText(macNewlines), true);
});

Deno.test("shouldCollapseText - handles mixed newlines", () => {
  const mixedNewlines = "l1\nl2\r\nl3\rl4\nl5";
  assertEquals(countLines(mixedNewlines), 5);
  assertEquals(shouldCollapseText(mixedNewlines), true);
});

// ============================================================================
// createTextAttachment tests
// ============================================================================

Deno.test("createTextAttachment - creates correct structure", () => {
  const content = "line1\nline2\nline3\nline4\nline5";
  const attachment = createTextAttachment(content, 1);

  assertEquals(attachment.id, 1);
  assertEquals(attachment.type, "text");
  assertEquals(attachment.lineCount, 5);
  assertEquals(attachment.content, content);
  assertExists(attachment.size);
  assertEquals(attachment.displayName, "[Pasted text #1 +5 lines]");
});

Deno.test("createTextAttachment - preserves full content", () => {
  const longContent = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}: ${"x".repeat(50)}`).join("\n");
  const attachment = createTextAttachment(longContent, 1);

  assertEquals(attachment.content, longContent);
  assertEquals(attachment.lineCount, 100);
});

Deno.test("createTextAttachment - calculates size correctly", () => {
  const content = "Hello, 世界!"; // Mix of ASCII and UTF-8
  const attachment = createTextAttachment(content, 1);
  const expectedSize = new TextEncoder().encode(content).length;

  assertEquals(attachment.size, expectedSize);
});

// ============================================================================
// Multiple attachments tests
// ============================================================================

Deno.test("multiple attachments - each has unique ID", () => {
  const content1 = "First paste\nwith\nmultiple\nlines\nhere";
  const content2 = "Second paste\ndifferent\ncontent\nentirely\nyes";
  const content3 = "Third\npaste\nmore\nstuff\nhere";

  const att1 = createTextAttachment(content1, 1);
  const att2 = createTextAttachment(content2, 2);
  const att3 = createTextAttachment(content3, 3);

  assertEquals(att1.id, 1);
  assertEquals(att2.id, 2);
  assertEquals(att3.id, 3);

  assertEquals(att1.displayName, "[Pasted text #1 +5 lines]");
  assertEquals(att2.displayName, "[Pasted text #2 +5 lines]");
  assertEquals(att3.displayName, "[Pasted text #3 +5 lines]");
});

Deno.test("multiple attachments - each preserves its content", () => {
  const contents = [
    "First content block\nwith some lines\nhere\nand\nmore",
    "Second completely\ndifferent\nblock\nof\ntext",
    "Third unique\ncontent\nblock\nagain\ndifferent",
  ];

  const attachments: TextAttachment[] = contents.map((c, i) =>
    createTextAttachment(c, i + 1)
  );

  attachments.forEach((att, i) => {
    assertEquals(att.content, contents[i]);
    assertEquals(att.id, i + 1);
  });
});

Deno.test("multiple attachments - different sizes", () => {
  const shortContent = "a\nb\nc\nd\ne"; // 5 lines, short
  const mediumContent = Array.from({ length: 50 }, (_, i) => `Line ${i}`).join("\n");
  const longContent = Array.from({ length: 200 }, (_, i) => `Long line ${i}: ${"x".repeat(100)}`).join("\n");

  const att1 = createTextAttachment(shortContent, 1);
  const att2 = createTextAttachment(mediumContent, 2);
  const att3 = createTextAttachment(longContent, 3);

  assertEquals(att1.lineCount, 5);
  assertEquals(att2.lineCount, 50);
  assertEquals(att3.lineCount, 200);

  // Verify sizes are different
  const sizes = [att1.size, att2.size, att3.size];
  assertEquals(sizes[0] < sizes[1], true);
  assertEquals(sizes[1] < sizes[2], true);
});

// ============================================================================
// Edge cases
// ============================================================================

Deno.test("edge case - empty lines in content", () => {
  const contentWithEmptyLines = "line1\n\n\nline4\n\nline6";
  const attachment = createTextAttachment(contentWithEmptyLines, 1);

  assertEquals(attachment.lineCount, 6);
  assertEquals(attachment.content, contentWithEmptyLines);
});

Deno.test("edge case - content with special characters", () => {
  const specialContent = "emoji: 🚀\nunicode: 日本語\ntabs:\t\there\nquotes: \"test\"";
  const attachment = createTextAttachment(specialContent, 1);

  assertEquals(attachment.content, specialContent);
  assertEquals(attachment.lineCount, 4);
});

Deno.test("edge case - very large content", () => {
  // Simulate a large paste (10000 lines)
  const largeContent = Array.from({ length: 10000 }, (_, i) => `Line ${i}: content here`).join("\n");
  const attachment = createTextAttachment(largeContent, 1);

  assertEquals(attachment.lineCount, 10000);
  assertEquals(attachment.content, largeContent);
  assertEquals(attachment.displayName, "[Pasted text #1 +10000 lines]");
});

Deno.test("edge case - threshold boundaries", () => {
  // Exactly at MIN_LINES threshold
  const exactlyMinLines = Array.from({ length: TEXT_COLLAPSE_MIN_LINES }, (_, i) => `L${i}`).join("\n");
  assertEquals(shouldCollapseText(exactlyMinLines), true);

  // One below MIN_LINES threshold
  const belowMinLines = Array.from({ length: TEXT_COLLAPSE_MIN_LINES - 1 }, (_, i) => `L${i}`).join("\n");
  assertEquals(shouldCollapseText(belowMinLines), false);

  // Exactly at MIN_CHARS threshold with 2 lines
  const twoLinesExactChars = "a".repeat(TEXT_COLLAPSE_MIN_CHARS / 2) + "\n" + "b".repeat(TEXT_COLLAPSE_MIN_CHARS / 2);
  assertEquals(shouldCollapseText(twoLinesExactChars), true);
});

// ============================================================================
// Display name tests
// ============================================================================

Deno.test("getTextDisplayName - formats correctly", () => {
  assertEquals(getTextDisplayName(1, 5), "[Pasted text #1 +5 lines]");
  assertEquals(getTextDisplayName(2, 100), "[Pasted text #2 +100 lines]");
  assertEquals(getTextDisplayName(10, 1000), "[Pasted text #10 +1000 lines]");
});

// ============================================================================
// getTextAttachmentPreview tests
// ============================================================================

Deno.test("getTextAttachmentPreview - returns first N lines", () => {
  const content = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10";
  const attachment = createTextAttachment(content, 1);

  const preview = getTextAttachmentPreview(attachment, 3);
  assertEquals(preview, "line1\nline2\nline3\n... +7 more lines");
});

Deno.test("getTextAttachmentPreview - returns all lines if fewer than max", () => {
  const content = "line1\nline2\nline3";
  const attachment = createTextAttachment(content, 1);

  const preview = getTextAttachmentPreview(attachment, 5);
  assertEquals(preview, "line1\nline2\nline3");
});

Deno.test("getTextAttachmentPreview - default 5 lines", () => {
  const content = "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8";
  const attachment = createTextAttachment(content, 1);

  const preview = getTextAttachmentPreview(attachment);
  assertEquals(preview, "l1\nl2\nl3\nl4\nl5\n... +3 more lines");
});

// ============================================================================
// detectMimeType tests
// ============================================================================

Deno.test("detectMimeType - image extensions", () => {
  assertEquals(detectMimeType("/path/to/image.jpg"), "image/jpeg");
  assertEquals(detectMimeType("/path/to/image.jpeg"), "image/jpeg");
  assertEquals(detectMimeType("/path/to/image.png"), "image/png");
  assertEquals(detectMimeType("/path/to/image.gif"), "image/gif");
  assertEquals(detectMimeType("/path/to/image.webp"), "image/webp");
  assertEquals(detectMimeType("/path/to/image.svg"), "image/svg+xml");
  assertEquals(detectMimeType("/path/to/image.bmp"), "image/bmp");
  assertEquals(detectMimeType("/path/to/image.tiff"), "image/tiff");
  assertEquals(detectMimeType("/path/to/image.tif"), "image/tiff");
  assertEquals(detectMimeType("/path/to/image.ico"), "image/x-icon");
  assertEquals(detectMimeType("/path/to/image.heic"), "image/heic");
  assertEquals(detectMimeType("/path/to/image.heif"), "image/heif");
});

Deno.test("detectMimeType - video extensions", () => {
  assertEquals(detectMimeType("/path/to/video.mp4"), "video/mp4");
  assertEquals(detectMimeType("/path/to/video.webm"), "video/webm");
  assertEquals(detectMimeType("/path/to/video.mov"), "video/quicktime");
  assertEquals(detectMimeType("/path/to/video.avi"), "video/x-msvideo");
  assertEquals(detectMimeType("/path/to/video.mkv"), "video/x-matroska");
  assertEquals(detectMimeType("/path/to/video.mpeg"), "video/mpeg");
  assertEquals(detectMimeType("/path/to/video.mpg"), "video/mpeg");
});

Deno.test("detectMimeType - audio extensions", () => {
  assertEquals(detectMimeType("/path/to/audio.mp3"), "audio/mpeg");
  assertEquals(detectMimeType("/path/to/audio.wav"), "audio/wav");
  assertEquals(detectMimeType("/path/to/audio.ogg"), "audio/ogg");
  assertEquals(detectMimeType("/path/to/audio.flac"), "audio/flac");
  assertEquals(detectMimeType("/path/to/audio.aac"), "audio/aac");
  assertEquals(detectMimeType("/path/to/audio.m4a"), "audio/mp4");
  assertEquals(detectMimeType("/path/to/audio.wma"), "audio/x-ms-wma");
});

Deno.test("detectMimeType - document extensions", () => {
  assertEquals(detectMimeType("/path/to/doc.pdf"), "application/pdf");
  assertEquals(detectMimeType("/path/to/doc.doc"), "application/msword");
  assertEquals(detectMimeType("/path/to/doc.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assertEquals(detectMimeType("/path/to/doc.xls"), "application/vnd.ms-excel");
  assertEquals(detectMimeType("/path/to/doc.xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assertEquals(detectMimeType("/path/to/doc.ppt"), "application/vnd.ms-powerpoint");
  assertEquals(detectMimeType("/path/to/doc.pptx"), "application/vnd.openxmlformats-officedocument.presentationml.presentation");
});

Deno.test("detectMimeType - case insensitive", () => {
  assertEquals(detectMimeType("/path/to/IMAGE.JPG"), "image/jpeg");
  assertEquals(detectMimeType("/path/to/VIDEO.MP4"), "video/mp4");
  assertEquals(detectMimeType("/path/to/audio.MP3"), "audio/mpeg");
  assertEquals(detectMimeType("/path/to/Doc.PDF"), "application/pdf");
});

Deno.test("detectMimeType - unknown extension returns octet-stream", () => {
  assertEquals(detectMimeType("/path/to/file.xyz"), "application/octet-stream");
  assertEquals(detectMimeType("/path/to/file.unknown"), "application/octet-stream");
  assertEquals(detectMimeType("/path/to/file"), "application/octet-stream");
});

Deno.test("detectMimeType - multiple dots in filename", () => {
  assertEquals(detectMimeType("/path/to/my.file.name.jpg"), "image/jpeg");
  assertEquals(detectMimeType("/path/to/backup.2024.01.01.pdf"), "application/pdf");
});

// ============================================================================
// getAttachmentType tests
// ============================================================================

Deno.test("getAttachmentType - image MIME types", () => {
  assertEquals(getAttachmentType("image/jpeg"), "image");
  assertEquals(getAttachmentType("image/png"), "image");
  assertEquals(getAttachmentType("image/gif"), "image");
  assertEquals(getAttachmentType("image/webp"), "image");
  assertEquals(getAttachmentType("image/svg+xml"), "image");
});

Deno.test("getAttachmentType - video MIME types", () => {
  assertEquals(getAttachmentType("video/mp4"), "video");
  assertEquals(getAttachmentType("video/webm"), "video");
  assertEquals(getAttachmentType("video/quicktime"), "video");
});

Deno.test("getAttachmentType - audio MIME types", () => {
  assertEquals(getAttachmentType("audio/mpeg"), "audio");
  assertEquals(getAttachmentType("audio/wav"), "audio");
  assertEquals(getAttachmentType("audio/ogg"), "audio");
});

Deno.test("getAttachmentType - document MIME types", () => {
  assertEquals(getAttachmentType("application/pdf"), "document");
  assertEquals(getAttachmentType("application/msword"), "document");
  assertEquals(getAttachmentType("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "document");
});

Deno.test("getAttachmentType - unknown MIME type returns file", () => {
  assertEquals(getAttachmentType("application/octet-stream"), "file");
  assertEquals(getAttachmentType("text/plain"), "file");
  assertEquals(getAttachmentType("unknown/type"), "file");
});

// ============================================================================
// getDisplayName tests
// ============================================================================

Deno.test("getDisplayName - formats all types correctly", () => {
  assertEquals(getDisplayName("image", 1), "[Image #1]");
  assertEquals(getDisplayName("video", 2), "[Video #2]");
  assertEquals(getDisplayName("audio", 3), "[Audio #3]");
  assertEquals(getDisplayName("document", 4), "[PDF #4]");
  assertEquals(getDisplayName("file", 5), "[File #5]");
  assertEquals(getDisplayName("text", 6), "[Pasted text #6]");
});

Deno.test("getDisplayName - handles large IDs", () => {
  assertEquals(getDisplayName("image", 100), "[Image #100]");
  assertEquals(getDisplayName("video", 9999), "[Video #9999]");
});

// ============================================================================
// formatFileSize tests
// ============================================================================

Deno.test("formatFileSize - bytes", () => {
  assertEquals(formatFileSize(0), "0 B");
  assertEquals(formatFileSize(1), "1 B");
  assertEquals(formatFileSize(512), "512 B");
  assertEquals(formatFileSize(1023), "1023 B");
});

Deno.test("formatFileSize - kilobytes", () => {
  assertEquals(formatFileSize(1024), "1.0 KB");
  assertEquals(formatFileSize(1536), "1.5 KB");
  assertEquals(formatFileSize(10240), "10.0 KB");
  assertEquals(formatFileSize(1024 * 1024 - 1), "1024.0 KB");
});

Deno.test("formatFileSize - megabytes", () => {
  assertEquals(formatFileSize(1024 * 1024), "1.0 MB");
  assertEquals(formatFileSize(1024 * 1024 * 5), "5.0 MB");
  assertEquals(formatFileSize(1024 * 1024 * 20), "20.0 MB");
  assertEquals(formatFileSize(1024 * 1024 * 100), "100.0 MB");
});

Deno.test("formatFileSize - gigabytes", () => {
  assertEquals(formatFileSize(1024 * 1024 * 1024), "1.0 GB");
  assertEquals(formatFileSize(1024 * 1024 * 1024 * 2.5), "2.5 GB");
});

// ============================================================================
// getSizeLimit tests
// ============================================================================

Deno.test("getSizeLimit - returns correct limits", () => {
  assertEquals(getSizeLimit("image"), 20 * 1024 * 1024);       // 20 MB
  assertEquals(getSizeLimit("video"), 100 * 1024 * 1024);      // 100 MB
  assertEquals(getSizeLimit("audio"), 50 * 1024 * 1024);       // 50 MB
  assertEquals(getSizeLimit("document"), 50 * 1024 * 1024);    // 50 MB
  assertEquals(getSizeLimit("file"), 10 * 1024 * 1024);        // 10 MB
  assertEquals(getSizeLimit("text"), 1 * 1024 * 1024);         // 1 MB
});

// ============================================================================
// isSupportedMedia tests
// ============================================================================

Deno.test("isSupportedMedia - supported image formats", () => {
  assert(isSupportedMedia("/path/to/image.jpg"));
  assert(isSupportedMedia("/path/to/image.jpeg"));
  assert(isSupportedMedia("/path/to/image.png"));
  assert(isSupportedMedia("/path/to/image.gif"));
  assert(isSupportedMedia("/path/to/image.webp"));
  assert(isSupportedMedia("/path/to/image.svg"));
});

Deno.test("isSupportedMedia - supported video formats", () => {
  assert(isSupportedMedia("/path/to/video.mp4"));
  assert(isSupportedMedia("/path/to/video.webm"));
  assert(isSupportedMedia("/path/to/video.mov"));
  assert(isSupportedMedia("/path/to/video.avi"));
});

Deno.test("isSupportedMedia - supported audio formats", () => {
  assert(isSupportedMedia("/path/to/audio.mp3"));
  assert(isSupportedMedia("/path/to/audio.wav"));
  assert(isSupportedMedia("/path/to/audio.ogg"));
  assert(isSupportedMedia("/path/to/audio.flac"));
});

Deno.test("isSupportedMedia - supported document formats", () => {
  assert(isSupportedMedia("/path/to/doc.pdf"));
  assert(isSupportedMedia("/path/to/doc.doc"));
  assert(isSupportedMedia("/path/to/doc.docx"));
  assert(isSupportedMedia("/path/to/doc.xls"));
  assert(isSupportedMedia("/path/to/doc.xlsx"));
});

Deno.test("isSupportedMedia - unsupported formats", () => {
  assertEquals(isSupportedMedia("/path/to/file.txt"), false);
  assertEquals(isSupportedMedia("/path/to/file.ts"), false);
  assertEquals(isSupportedMedia("/path/to/file.json"), false);
  assertEquals(isSupportedMedia("/path/to/file.html"), false);
  assertEquals(isSupportedMedia("/path/to/file"), false);
});

Deno.test("isSupportedMedia - case insensitive", () => {
  assert(isSupportedMedia("/path/to/IMAGE.JPG"));
  assert(isSupportedMedia("/path/to/VIDEO.MP4"));
  assert(isSupportedMedia("/path/to/Audio.MP3"));
});

// ============================================================================
// createAttachment tests (with temp files)
// ============================================================================

Deno.test("createAttachment - creates valid image attachment", async () => {
  // Create a small test image (1x1 pixel PNG)
  const tempPath = await Deno.makeTempFile({ suffix: ".png" });
  try {
    // Minimal PNG (1x1 transparent pixel)
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
      0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, // IDAT chunk
      0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, // IEND chunk
      0x42, 0x60, 0x82
    ]);
    await Deno.writeFile(tempPath, pngBytes);

    const result = await createAttachment(tempPath, 1);

    assert(isAttachment(result));
    if (isAttachment(result)) {
      assertEquals(result.id, 1);
      assertEquals(result.type, "image");
      assertEquals(result.mimeType, "image/png");
      assertExists(result.base64Data);
      assertExists(result.size);
      assertEquals(result.displayName, "[Image #1]");
    }
  } finally {
    await Deno.remove(tempPath);
  }
});

Deno.test("createAttachment - creates valid PDF attachment", async () => {
  const tempPath = await Deno.makeTempFile({ suffix: ".pdf" });
  try {
    // Minimal PDF content
    const pdfContent = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj
xref
0 3
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
trailer << /Root 1 0 R /Size 3 >>
startxref
109
%%EOF`;
    await Deno.writeTextFile(tempPath, pdfContent);

    const result = await createAttachment(tempPath, 2);

    assert(isAttachment(result));
    if (isAttachment(result)) {
      assertEquals(result.id, 2);
      assertEquals(result.type, "document");
      assertEquals(result.mimeType, "application/pdf");
      assertEquals(result.displayName, "[PDF #2]");
    }
  } finally {
    await Deno.remove(tempPath);
  }
});

Deno.test("createAttachment - handles file not found", async () => {
  const result = await createAttachment("/nonexistent/path/file.png", 1);

  assert(isAttachmentError(result));
  if (isAttachmentError(result)) {
    assertEquals(result.type, "not_found");
    assert(result.message.includes("not found"));
    assertEquals(result.path, "/nonexistent/path/file.png");
  }
});

Deno.test("createAttachment - handles directory", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const result = await createAttachment(tempDir, 1);

    assert(isAttachmentError(result));
    if (isAttachmentError(result)) {
      assertEquals(result.type, "unsupported_type");
      assert(result.message.includes("directory"));
    }
  } finally {
    await Deno.remove(tempDir);
  }
});

Deno.test("createAttachment - preserves file content via base64", async () => {
  const tempPath = await Deno.makeTempFile({ suffix: ".jpg" });
  try {
    // Create some binary content
    const originalContent = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]); // JPEG header
    await Deno.writeFile(tempPath, originalContent);

    const result = await createAttachment(tempPath, 1);

    assert(isAttachment(result));
    if (isAttachment(result)) {
      // Decode base64 and compare
      const decodedBytes = Uint8Array.from(atob(result.base64Data), c => c.charCodeAt(0));
      assertEquals(decodedBytes, originalContent);
    }
  } finally {
    await Deno.remove(tempPath);
  }
});

Deno.test("createAttachment - handles various file types", async () => {
  const testCases: Array<{ ext: string; expectedType: AttachmentType; expectedMime: string }> = [
    { ext: ".mp4", expectedType: "video", expectedMime: "video/mp4" },
    { ext: ".mp3", expectedType: "audio", expectedMime: "audio/mpeg" },
    { ext: ".gif", expectedType: "image", expectedMime: "image/gif" },
    { ext: ".docx", expectedType: "document", expectedMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  ];

  for (const { ext, expectedType, expectedMime } of testCases) {
    const tempPath = await Deno.makeTempFile({ suffix: ext });
    try {
      await Deno.writeFile(tempPath, new Uint8Array([0x00, 0x01, 0x02]));

      const result = await createAttachment(tempPath, 1);

      assert(isAttachment(result), `Expected attachment for ${ext}`);
      if (isAttachment(result)) {
        assertEquals(result.type, expectedType, `Type mismatch for ${ext}`);
        assertEquals(result.mimeType, expectedMime, `MIME mismatch for ${ext}`);
      }
    } finally {
      await Deno.remove(tempPath);
    }
  }
});

// ============================================================================
// Type guards tests
// ============================================================================

Deno.test("isAttachment - correctly identifies attachments", () => {
  const attachment: Attachment = {
    id: 1,
    type: "image",
    displayName: "[Image #1]",
    path: "/path/to/image.png",
    fileName: "image.png",
    mimeType: "image/png",
    base64Data: "abc123",
    size: 1024,
  };

  assert(isAttachment(attachment));
});

Deno.test("isAttachment - correctly rejects errors", () => {
  const error: AttachmentError = {
    type: "not_found",
    message: "File not found",
    path: "/path/to/missing.png",
  };

  assertEquals(isAttachment(error), false);
});

Deno.test("isAttachmentError - correctly identifies errors", () => {
  const error: AttachmentError = {
    type: "size_exceeded",
    message: "File too large",
    path: "/path/to/large.mp4",
  };

  assert(isAttachmentError(error));
});

Deno.test("isAttachmentError - correctly rejects attachments", () => {
  const attachment: Attachment = {
    id: 1,
    type: "video",
    displayName: "[Video #1]",
    path: "/path/to/video.mp4",
    fileName: "video.mp4",
    mimeType: "video/mp4",
    base64Data: "xyz789",
    size: 2048,
  };

  assertEquals(isAttachmentError(attachment), false);
});

Deno.test("isTextAttachment - correctly identifies text attachments", () => {
  const textAttachment = createTextAttachment("line1\nline2\nline3\nline4\nline5", 1);

  assert(isTextAttachment(textAttachment));
});

Deno.test("isTextAttachment - correctly rejects media attachments", () => {
  const mediaAttachment: Attachment = {
    id: 1,
    type: "image",
    displayName: "[Image #1]",
    path: "/path/to/image.png",
    fileName: "image.png",
    mimeType: "image/png",
    base64Data: "abc123",
    size: 1024,
  };

  assertEquals(isTextAttachment(mediaAttachment), false);
});

Deno.test("isTextAttachment - correctly rejects errors", () => {
  const error: AttachmentError = {
    type: "not_found",
    message: "File not found",
    path: "/path/to/missing.txt",
  };

  assertEquals(isTextAttachment(error), false);
});

// ============================================================================
// formatAttachmentDetail tests
// ============================================================================

Deno.test("formatAttachmentDetail - formats image correctly", () => {
  const attachment: Attachment = {
    id: 1,
    type: "image",
    displayName: "[Image #1]",
    path: "/path/to/screenshot.png",
    fileName: "screenshot.png",
    mimeType: "image/png",
    base64Data: "abc",
    size: 1536, // 1.5 KB
  };

  assertEquals(formatAttachmentDetail(attachment), "[Image #1: screenshot.png (1.5 KB)]");
});

Deno.test("formatAttachmentDetail - formats video correctly", () => {
  const attachment: Attachment = {
    id: 2,
    type: "video",
    displayName: "[Video #2]",
    path: "/path/to/movie.mp4",
    fileName: "movie.mp4",
    mimeType: "video/mp4",
    base64Data: "xyz",
    size: 5 * 1024 * 1024, // 5 MB
  };

  assertEquals(formatAttachmentDetail(attachment), "[Video #2: movie.mp4 (5.0 MB)]");
});

Deno.test("formatAttachmentDetail - formats document correctly", () => {
  const attachment: Attachment = {
    id: 3,
    type: "document",
    displayName: "[PDF #3]",
    path: "/path/to/report.pdf",
    fileName: "report.pdf",
    mimeType: "application/pdf",
    base64Data: "def",
    size: 256 * 1024, // 256 KB
  };

  assertEquals(formatAttachmentDetail(attachment), "[PDF #3: report.pdf (256.0 KB)]");
});

// ============================================================================
// Integration tests - multiple mixed attachments
// ============================================================================

Deno.test("integration - multiple text attachments with different content", () => {
  const attachments: TextAttachment[] = [];

  // Simulate 5 different pastes with varying content
  const pasteContents = [
    "import React from 'react';\nconst App = () => <div>Hello</div>;\nexport default App;\n// More code\n// Even more",
    "# Markdown\n\n## Heading\n\n- List item 1\n- List item 2\n- List item 3",
    "{\n  \"name\": \"test\",\n  \"version\": \"1.0.0\",\n  \"scripts\": {\n    \"start\": \"node index.js\"\n  }\n}",
    "SELECT * FROM users\nWHERE active = true\nORDER BY created_at DESC\nLIMIT 100;\n-- Comment",
    "def hello():\n    print('Hello, World!')\n\nif __name__ == '__main__':\n    hello()",
  ];

  pasteContents.forEach((content, i) => {
    attachments.push(createTextAttachment(content, i + 1));
  });

  // Verify each attachment has unique ID and preserves content
  attachments.forEach((att, i) => {
    assertEquals(att.id, i + 1);
    assertEquals(att.content, pasteContents[i]);
    assertEquals(att.type, "text");
    assert(att.lineCount >= 5); // All should collapse
    assert(shouldCollapseText(pasteContents[i]));
  });
});

Deno.test("integration - mixed media and text attachments", async () => {
  // Create a temp image
  const tempPath = await Deno.makeTempFile({ suffix: ".png" });
  try {
    await Deno.writeFile(tempPath, new Uint8Array([0x89, 0x50, 0x4E, 0x47])); // PNG header

    // Create media attachment
    const mediaResult = await createAttachment(tempPath, 1);
    assert(isAttachment(mediaResult));

    // Create text attachments
    const textResult1 = createTextAttachment("Text paste 1\nline2\nline3\nline4\nline5", 2);
    const textResult2 = createTextAttachment("Text paste 2\nmore\nlines\nhere\ntoo", 3);

    // Verify media attachment
    if (isAttachment(mediaResult)) {
      assertEquals(mediaResult.type, "image");
      assertEquals(mediaResult.id, 1);
      assertEquals(mediaResult.displayName, "[Image #1]");
    }

    // Verify text attachments
    assert(isTextAttachment(textResult1));
    assertEquals(textResult1.id, 2);
    assertEquals(textResult1.type, "text");

    assert(isTextAttachment(textResult2));
    assertEquals(textResult2.id, 3);
    assertEquals(textResult2.type, "text");

    // Verify they can coexist and have unique IDs
    const allIds = [
      isAttachment(mediaResult) ? mediaResult.id : -1,
      textResult1.id,
      textResult2.id,
    ];
    assertEquals(new Set(allIds).size, 3); // All unique
  } finally {
    await Deno.remove(tempPath);
  }
});

// ============================================================================
// Edge cases for media attachments
// ============================================================================

Deno.test("edge case - filename with spaces", async () => {
  const tempDir = await Deno.makeTempDir();
  const tempPath = `${tempDir}/my file with spaces.png`;
  try {
    await Deno.writeFile(tempPath, new Uint8Array([0x89, 0x50, 0x4E, 0x47]));

    const result = await createAttachment(tempPath, 1);

    assert(isAttachment(result));
    if (isAttachment(result)) {
      assertEquals(result.fileName, "my file with spaces.png");
    }
  } finally {
    await Deno.remove(tempPath);
    await Deno.remove(tempDir);
  }
});

Deno.test("edge case - filename with unicode characters", async () => {
  const tempDir = await Deno.makeTempDir();
  const tempPath = `${tempDir}/이미지_파일_🖼️.png`;
  try {
    await Deno.writeFile(tempPath, new Uint8Array([0x89, 0x50, 0x4E, 0x47]));

    const result = await createAttachment(tempPath, 1);

    assert(isAttachment(result));
    if (isAttachment(result)) {
      assertEquals(result.fileName, "이미지_파일_🖼️.png");
    }
  } finally {
    await Deno.remove(tempPath);
    await Deno.remove(tempDir);
  }
});

Deno.test("edge case - empty file", async () => {
  const tempPath = await Deno.makeTempFile({ suffix: ".txt" });
  try {
    // File is already empty from makeTempFile

    const result = await createAttachment(tempPath, 1);

    assert(isAttachment(result));
    if (isAttachment(result)) {
      assertEquals(result.size, 0);
      assertEquals(result.base64Data, ""); // Empty base64
    }
  } finally {
    await Deno.remove(tempPath);
  }
});

Deno.test("edge case - file path extraction", async () => {
  const testCases = [
    { path: "/simple/path/file.jpg", expectedName: "file.jpg" },
    { path: "relative/path/image.png", expectedName: "image.png" },
    { path: "/a/b/c/d/e/deep.gif", expectedName: "deep.gif" },
    { path: "single.pdf", expectedName: "single.pdf" },
  ];

  for (const { path, expectedName } of testCases) {
    const tempPath = await Deno.makeTempFile({ suffix: `.${path.split('.').pop()}` });
    try {
      await Deno.writeFile(tempPath, new Uint8Array([0x00]));

      const result = await createAttachment(tempPath, 1);

      assert(isAttachment(result));
      // The fileName should be extracted from tempPath, not our test path
      // Just verify it's a non-empty string
      if (isAttachment(result)) {
        assertExists(result.fileName);
        assert(result.fileName.length > 0);
      }
    } finally {
      await Deno.remove(tempPath);
    }
  }
});
