import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import {
  handleGetAttachment,
  handleGetAttachmentContent,
  handleRegisterAttachment,
  handleUploadAttachment,
} from "../../../src/hlvm/cli/repl/handlers/attachments.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempDir, withTempHlvmDir } from "../helpers.ts";

Deno.test("POST /api/attachments/register — registers file and returns record", async () => {
  await withTempHlvmDir(async () => {
    await withTempDir(async (tempDir) => {
      const filePath = getPlatform().path.join(tempDir, "hello.txt");
      await getPlatform().fs.writeTextFile(filePath, "hello world");

      const req = new Request("http://localhost/api/attachments/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath }),
      });
      const res = await handleRegisterAttachment(req);
      assertEquals(res.status, 201);

      const body = await res.json();
      assertExists(body.id);
      assertEquals(body.fileName, "hello.txt");
      assertEquals(body.mimeType, "text/plain");
      assertEquals(body.kind, "text");
      assert(body.size > 0);
    });
  });
});

Deno.test("POST /api/attachments/register — rejects missing path", async () => {
  await withTempHlvmDir(async () => {
    const req = new Request("http://localhost/api/attachments/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "" }),
    });
    const res = await handleRegisterAttachment(req);
    assertEquals(res.status, 400);
  });
});

Deno.test("POST /api/attachments/register — rejects nonexistent file", async () => {
  await withTempHlvmDir(async () => {
    const req = new Request("http://localhost/api/attachments/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/tmp/does-not-exist-attachment-test.txt" }),
    });
    const res = await handleRegisterAttachment(req);
    assertEquals(res.status, 404);
  });
});

Deno.test("POST /api/attachments/upload — uploads bytes and returns record", async () => {
  await withTempHlvmDir(async () => {
    const content = "uploaded content";
    const file = new File([content], "upload.txt", { type: "text/plain" });
    const form = new FormData();
    form.append("file", file);

    const req = new Request("http://localhost/api/attachments/upload", {
      method: "POST",
      body: form,
    });
    const res = await handleUploadAttachment(req);
    assertEquals(res.status, 201);

    const body = await res.json();
    assertExists(body.id);
    assertEquals(body.fileName, "upload.txt");
    assertEquals(body.mimeType, "text/plain");
  });
});

Deno.test("POST /api/attachments/upload — rejects missing file field", async () => {
  await withTempHlvmDir(async () => {
    const form = new FormData();
    form.append("notfile", "value");

    const req = new Request("http://localhost/api/attachments/upload", {
      method: "POST",
      body: form,
    });
    const res = await handleUploadAttachment(req);
    assertEquals(res.status, 400);
  });
});

Deno.test("GET /api/attachments/:id — returns record by ID", async () => {
  await withTempHlvmDir(async () => {
    await withTempDir(async (tempDir) => {
      const filePath = getPlatform().path.join(tempDir, "lookup.txt");
      await getPlatform().fs.writeTextFile(filePath, "lookup content");

      const registerReq = new Request("http://localhost/api/attachments/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath }),
      });
      const registerRes = await handleRegisterAttachment(registerReq);
      const registered = await registerRes.json();

      const getReq = new Request(`http://localhost/api/attachments/${registered.id}`);
      const getRes = await handleGetAttachment(getReq, { id: registered.id });
      assertEquals(getRes.status, 200);

      const body = await getRes.json();
      assertEquals(body.id, registered.id);
      assertEquals(body.fileName, "lookup.txt");
    });
  });
});

Deno.test("GET /api/attachments/:id/content — returns raw bytes", async () => {
  await withTempHlvmDir(async () => {
    await withTempDir(async (tempDir) => {
      const originalContent = "raw bytes content";
      const filePath = getPlatform().path.join(tempDir, "raw.txt");
      await getPlatform().fs.writeTextFile(filePath, originalContent);

      const registerReq = new Request("http://localhost/api/attachments/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath }),
      });
      const registerRes = await handleRegisterAttachment(registerReq);
      const registered = await registerRes.json();

      const contentReq = new Request(`http://localhost/api/attachments/${registered.id}/content`);
      const contentRes = await handleGetAttachmentContent(contentReq, { id: registered.id });
      assertEquals(contentRes.status, 200);
      assertEquals(contentRes.headers.get("Content-Type"), "text/plain");

      const text = await contentRes.text();
      assertEquals(text, originalContent);
    });
  });
});
