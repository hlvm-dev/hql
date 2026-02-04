import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  applyRequestHintsToToolArgs,
  inferFileRequestHints,
  inferRequestHints,
} from "../../../src/hlvm/agent/request-hints.ts";

Deno.test({
  name: "Request hints: infer Downloads path and pdf pattern",
  fn() {
    const hints = inferFileRequestHints("list pdfs in Downloads");
    assertEquals(hints?.path, "~/Downloads");
    assertEquals(hints?.pattern, "*.pdf");
    assertEquals(hints?.pathRoots, ["~/Downloads"]);
  },
});

Deno.test({
  name: "Request hints: apply list_files args",
  fn() {
    const hints = inferRequestHints("list pdfs in Downloads");
    const updated = applyRequestHintsToToolArgs("list_files", {}, hints);
    assertEquals(updated, { path: "~/Downloads", pattern: "*.pdf" });
  },
});

Deno.test({
  name: "Request hints: infer Downloads path and image pattern",
  fn() {
    const hints = inferFileRequestHints("list all image files in Downloads");
    assertEquals(hints?.path, "~/Downloads");
    assertEquals(hints?.pattern, undefined);
    assertEquals(hints?.mimePrefix, "image/");
    assertEquals(hints?.pathRoots, ["~/Downloads"]);
  },
});

Deno.test({
  name: "Request hints: apply list_files args for images",
  fn() {
    const hints = inferRequestHints("list all image files in Downloads");
    const updated = applyRequestHintsToToolArgs("list_files", {}, hints);
    assertEquals(updated, {
      path: "~/Downloads",
      mimePrefix: "image/",
    });
  },
});
