import { assertEquals } from "jsr:@std/assert";
import { registerUploadedAttachment } from "../../../src/hlvm/attachments/service.ts";
import {
  checkModelAttachmentIds,
  checkModelAttachmentMimeTypes,
  describeAttachmentFailure,
  getSupportedAttachmentKindsForModel,
} from "../../../src/hlvm/cli/attachment-policy.ts";
import {
  getConversationAttachmentKind,
  getConversationAttachmentMimeType,
  isSupportedConversationAttachmentPath,
  isSupportedConversationMedia,
} from "../../../src/hlvm/cli/repl/attachment.ts";
import type {
  ModelInfo,
  ProviderCapability,
} from "../../../src/hlvm/providers/types.ts";
import { withTempHlvmDir } from "../helpers.ts";

function createModelInfo(
  capabilities: readonly ProviderCapability[],
): ModelInfo {
  return {
    name: "test-model",
    capabilities: [...capabilities],
  };
}

Deno.test("attachment policy: text files stay outside legacy media handling but are accepted by the broad attachment path", () => {
  assertEquals(isSupportedConversationMedia("/tmp/notes.md"), false);
  assertEquals(isSupportedConversationAttachmentPath("/tmp/notes.md"), true);
  assertEquals(
    getConversationAttachmentMimeType("/tmp/notes.md"),
    "text/plain",
  );
  assertEquals(getConversationAttachmentKind("text/markdown"), "text");
});

Deno.test("attachment policy: Claude models allow PDF attachments on vision models", async () => {
  const support = await checkModelAttachmentMimeTypes(
    "claude-code/claude-opus-4-6",
    ["application/pdf"],
    createModelInfo(["chat", "tools", "vision"]),
  );

  assertEquals(
    getSupportedAttachmentKindsForModel("claude-code/claude-opus-4-6", null),
    ["image", "pdf", "text"],
  );
  assertEquals(support.supported, true);
});

Deno.test("attachment policy: OpenAI models allow extracted text attachments", async () => {
  const support = await checkModelAttachmentMimeTypes(
    "openai/gpt-4.1",
    ["text/plain"],
    createModelInfo(["chat", "tools", "vision"]),
  );

  assertEquals(
    getSupportedAttachmentKindsForModel("openai/gpt-4.1", null),
    ["image", "pdf", "text"],
  );
  assertEquals(support.supported, true);
});

Deno.test("attachment policy: text-only models can accept PDF attachments via extracted text fallback", async () => {
  await withTempHlvmDir(async () => {
    const pdf = await registerUploadedAttachment({
      fileName: "doc.pdf",
      bytes: new TextEncoder().encode(`%PDF-1.4\n1 0 obj\n(Hello PDF)\nendobj\n%%EOF`),
      mimeType: "application/pdf",
    });

    const support = await checkModelAttachmentIds(
      "ollama/llama3.2",
      [pdf.id],
      createModelInfo(["chat"]),
    );

    assertEquals(
      getSupportedAttachmentKindsForModel("ollama/llama3.2", null),
      ["image", "text"],
    );
    assertEquals(support.supported, true);
  });
});

Deno.test("attachment policy: multimodal file inputs still require vision", async () => {
  const support = await checkModelAttachmentMimeTypes(
    "anthropic/claude-sonnet-4-5-20250929",
    ["application/pdf"],
    createModelInfo(["chat", "tools"]),
  );

  assertEquals(support.supported, false);
  assertEquals(support.unsupportedKind, undefined);
});

Deno.test("attachment policy: describeAttachmentFailure distinguishes catalog failure", () => {
  const msg = describeAttachmentFailure(
    { supported: false, supportedKinds: ["image", "pdf"], catalogFailed: true },
    "ollama/llava",
  );
  assertEquals(msg.includes("Could not verify"), true);
  assertEquals(msg.includes("ollama/llava"), true);
});

Deno.test("attachment policy: describeAttachmentFailure distinguishes unsupported kind", () => {
  const msg = describeAttachmentFailure(
    {
      supported: false,
      supportedKinds: ["image", "pdf"],
      unsupportedKind: "video",
    },
    "anthropic/claude-sonnet-4-5-20250929",
  );
  assertEquals(msg.includes("does not support video"), true);
  assertEquals(msg.includes("Supported:"), true);
});
