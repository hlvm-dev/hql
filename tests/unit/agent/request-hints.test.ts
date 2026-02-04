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
  name: "Request hints: override absolute named-folder paths",
  fn() {
    const hints = inferRequestHints("list files in Downloads");
    const updated = applyRequestHintsToToolArgs("list_files", {
      path: "/home/user/Downloads",
    }, hints);
    assertEquals(updated, { path: "~/Downloads" });
  },
});

Deno.test({
  name: "Request hints: infer Downloads path and image pattern",
  fn() {
    const hints = inferFileRequestHints("list all image files in Downloads");
    assertEquals(hints?.path, "~/Downloads");
    assertEquals(hints?.pattern, undefined);
    assertEquals(hints?.mimePrefix, "image/");
    assertEquals(hints?.recursive, true);
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
      recursive: true,
    });
  },
});

Deno.test({
  name: "Request hints: infer Desktop path and video mime",
  fn() {
    const hints = inferFileRequestHints("list all videos in Desktop");
    assertEquals(hints?.path, "~/Desktop");
    assertEquals(hints?.pattern, undefined);
    assertEquals(hints?.mimePrefix, "video/");
    assertEquals(hints?.recursive, true);
    assertEquals(hints?.pathRoots, ["~/Desktop"]);
  },
});

Deno.test({
  name: "Request hints: apply list_files args for videos (override pattern)",
  fn() {
    const hints = inferRequestHints("list all videos in Desktop");
    const updated = applyRequestHintsToToolArgs("list_files", {
      path: "~/Desktop",
      pattern: "*.mp4",
    }, hints);
    assertEquals(updated, {
      path: "~/Desktop",
      mimePrefix: "video/",
      recursive: true,
    });
  },
});
