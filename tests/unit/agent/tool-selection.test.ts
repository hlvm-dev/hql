import { assertEquals } from "jsr:@std/assert";
import {
  selectToolAllowlist,
  shouldRequireToolCalls,
} from "../../../src/hlvm/agent/tool-selection.ts";

Deno.test({
  name: "Tool selection: file request yields file tools",
  fn() {
    const allowlist = selectToolAllowlist("list pdfs in Downloads");
    assertEquals(Array.isArray(allowlist), true);
    assertEquals(allowlist!.includes("list_files"), true);
    assertEquals(shouldRequireToolCalls(allowlist), true);
  },
});
