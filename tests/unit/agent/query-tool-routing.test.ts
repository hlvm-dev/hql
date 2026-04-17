import { assertEquals } from "jsr:@std/assert";
import {
  REPL_MAIN_THREAD_QUERY_SOURCE,
  resolveMainThreadBaselineToolAllowlist,
  resolveQueryToolAllowlist,
} from "../../../src/hlvm/agent/query-tool-routing.ts";

Deno.test("query-tool-routing preserves explicit empty allowlists", () => {
  assertEquals(resolveQueryToolAllowlist([]), []);
});

Deno.test("query-tool-routing uses main-thread eager core only when allowlist is absent", () => {
  const absent = resolveMainThreadBaselineToolAllowlist({
    querySource: REPL_MAIN_THREAD_QUERY_SOURCE,
    toolAllowlist: undefined,
  });
  const explicitEmpty = resolveMainThreadBaselineToolAllowlist({
    querySource: REPL_MAIN_THREAD_QUERY_SOURCE,
    toolAllowlist: [],
  });

  assertEquals((absent?.length ?? 0) > 0, true);
  assertEquals(explicitEmpty, []);
});
