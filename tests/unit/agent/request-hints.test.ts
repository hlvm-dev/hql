import { assertEquals } from "jsr:@std/assert";
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
