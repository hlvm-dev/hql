import { assertEquals } from "jsr:@std/assert";
import type { ConversationAttachmentPayload } from "../../../src/hlvm/attachments/types.ts";
import {
  deriveExecutionTurnContextFromAttachments,
  EMPTY_EXECUTION_TURN_CONTEXT,
  hasVisionRelevantTurnContext,
  normalizeExecutionTurnContext,
  summarizeExecutionTurnContext,
} from "../../../src/hlvm/agent/turn-context.ts";

Deno.test("turn context: deriveExecutionTurnContextFromAttachments returns empty for undefined/empty", () => {
  assertEquals(deriveExecutionTurnContextFromAttachments(undefined), {
    ...EMPTY_EXECUTION_TURN_CONTEXT,
  });
  assertEquals(deriveExecutionTurnContextFromAttachments([]), {
    ...EMPTY_EXECUTION_TURN_CONTEXT,
  });
});

Deno.test("turn context: deriveExecutionTurnContextFromAttachments counts mixed attachments correctly", () => {
  const attachments: ConversationAttachmentPayload[] = [
    {
      mode: "binary",
      attachmentId: "a1",
      fileName: "photo.png",
      mimeType: "image/png",
      kind: "image",
      conversationKind: "image",
      size: 1024,
      data: "base64data",
    },
    {
      mode: "text",
      attachmentId: "a2",
      fileName: "notes.txt",
      mimeType: "text/plain",
      kind: "text",
      conversationKind: "text",
      size: 100,
      text: "hello",
    },
    {
      mode: "binary",
      attachmentId: "a3",
      fileName: "doc.pdf",
      mimeType: "application/pdf",
      kind: "pdf",
      conversationKind: "pdf",
      size: 2048,
      data: "base64pdf",
    },
  ];
  const ctx = deriveExecutionTurnContextFromAttachments(attachments);
  assertEquals(ctx.attachmentCount, 3);
  assertEquals(ctx.attachmentKinds, ["image", "pdf", "text"]);
  assertEquals(ctx.visionEligibleAttachmentCount, 2);
  assertEquals(ctx.visionEligibleKinds, ["image", "pdf"]);
});

Deno.test("turn context: text-mode image attachment is not vision-eligible", () => {
  const attachments: ConversationAttachmentPayload[] = [
    {
      mode: "text",
      attachmentId: "a1",
      fileName: "description.txt",
      mimeType: "text/plain",
      kind: "image",
      conversationKind: "text",
      size: 50,
      text: "alt text for image",
    },
  ];
  const ctx = deriveExecutionTurnContextFromAttachments(attachments);
  assertEquals(ctx.attachmentCount, 1);
  assertEquals(ctx.visionEligibleAttachmentCount, 0);
  assertEquals(ctx.visionEligibleKinds, []);
});

Deno.test("turn context: normalizeExecutionTurnContext handles invalid input", () => {
  assertEquals(normalizeExecutionTurnContext(null), {
    ...EMPTY_EXECUTION_TURN_CONTEXT,
  });
  assertEquals(normalizeExecutionTurnContext("string"), {
    ...EMPTY_EXECUTION_TURN_CONTEXT,
  });
  assertEquals(normalizeExecutionTurnContext([1, 2]), {
    ...EMPTY_EXECUTION_TURN_CONTEXT,
  });
  const result = normalizeExecutionTurnContext({
    attachmentCount: 2,
    attachmentKinds: ["image", "bogus"],
    visionEligibleAttachmentCount: 1,
    visionEligibleKinds: ["image", "video"],
  });
  assertEquals(result.attachmentKinds, ["image"]);
  assertEquals(result.visionEligibleKinds, ["image"]);
  assertEquals(result.attachmentCount, 2);
  assertEquals(result.visionEligibleAttachmentCount, 1);
});

Deno.test("turn context: summarizeExecutionTurnContext formats correctly", () => {
  assertEquals(
    summarizeExecutionTurnContext(undefined),
    "no attachments on the last auto turn",
  );
  assertEquals(
    summarizeExecutionTurnContext({ ...EMPTY_EXECUTION_TURN_CONTEXT }),
    "no attachments on the last auto turn",
  );
  assertEquals(
    summarizeExecutionTurnContext({
      attachmentCount: 2,
      attachmentKinds: ["image", "pdf"],
      visionEligibleAttachmentCount: 2,
      visionEligibleKinds: ["image", "pdf"],
    }),
    "2 attachment(s) · kinds=image, pdf · vision-eligible=2 (image, pdf)",
  );
});

Deno.test("turn context: hasVisionRelevantTurnContext returns correct boolean", () => {
  assertEquals(hasVisionRelevantTurnContext(undefined), false);
  assertEquals(
    hasVisionRelevantTurnContext({ ...EMPTY_EXECUTION_TURN_CONTEXT }),
    false,
  );
  assertEquals(
    hasVisionRelevantTurnContext({
      attachmentCount: 1,
      attachmentKinds: ["text"],
      visionEligibleAttachmentCount: 0,
      visionEligibleKinds: [],
    }),
    true,
  );
});
