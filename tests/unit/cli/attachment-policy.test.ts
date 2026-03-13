import { assertEquals } from "jsr:@std/assert";
import {
  checkModelAttachmentMimeTypes,
  describeAttachmentFailure,
  getSupportedAttachmentKindsForModel,
} from "../../../src/hlvm/cli/attachment-policy.ts";
import {
  getConversationAttachmentKind,
  getConversationAttachmentMimeType,
  isSupportedConversationMedia,
} from "../../../src/hlvm/cli/repl/attachment.ts";
import type {
  ModelInfo,
  ProviderCapability,
} from "../../../src/hlvm/providers/types.ts";

function createModelInfo(
  capabilities: readonly ProviderCapability[],
): ModelInfo {
  return {
    name: "test-model",
    capabilities: [...capabilities],
  };
}

Deno.test("attachment policy: text files normalize internally but remain outside the surfaced attachment set", () => {
  assertEquals(isSupportedConversationMedia("/tmp/notes.md"), false);
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
    ["image", "pdf"],
  );
  assertEquals(support.supported, true);
});

Deno.test("attachment policy: OpenAI models reject text attachments", async () => {
  const support = await checkModelAttachmentMimeTypes(
    "openai/gpt-4.1",
    ["text/plain"],
    createModelInfo(["chat", "tools", "vision"]),
  );

  assertEquals(
    getSupportedAttachmentKindsForModel("openai/gpt-4.1", null),
    ["image", "pdf"],
  );
  assertEquals(support.supported, false);
  assertEquals(support.unsupportedKind, "text");
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
