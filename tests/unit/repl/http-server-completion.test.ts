import { assertEquals } from "jsr:@std/assert";
import { handleComplete } from "../../../src/hlvm/cli/repl/http-server.ts";
import { registerAttachmentFromPath } from "../../../src/hlvm/attachments/service.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempHlvmDir } from "../helpers.ts";

function completionRequest(body: unknown): Request {
  return new Request("http://localhost/api/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("http completions hide already-attached files when attachment_ids are provided", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const attachedPath = platform.path.resolve(
      "website/public/hlvm_dragon.png",
    );
    const attachment = await registerAttachmentFromPath(attachedPath);

    const response = await handleComplete(completionRequest({
      text: "@website/public/hlvm_dragon",
      cursor: "@website/public/hlvm_dragon".length,
      attachment_ids: [attachment.id],
    }));

    assertEquals(response.status, 200);
    const body = await response.json() as {
      items: Array<{ label: string }>;
    };

    assertEquals(
      body.items.some((item) =>
        item.label === "website/public/hlvm_dragon.png"
      ),
      false,
    );
    assertEquals(
      body.items.some((item) =>
        item.label === "website/public/hlvm_dragon_dark.png"
      ),
      true,
    );
  });
});

Deno.test("http completions hide already-attached files when attachment_paths are provided", async () => {
  const platform = getPlatform();
  const attachedPath = platform.path.resolve("website/public/hlvm_dragon.png");

  const response = await handleComplete(completionRequest({
    text: "@website/public/hlvm_dragon",
    cursor: "@website/public/hlvm_dragon".length,
    attachment_paths: [attachedPath],
  }));

  assertEquals(response.status, 200);
  const body = await response.json() as {
    items: Array<{ label: string }>;
  };

  assertEquals(
    body.items.some((item) => item.label === "website/public/hlvm_dragon.png"),
    false,
  );
  assertEquals(
    body.items.some((item) =>
      item.label === "website/public/hlvm_dragon_dark.png"
    ),
    true,
  );
});
