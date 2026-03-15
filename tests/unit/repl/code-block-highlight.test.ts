import { assertEquals } from "jsr:@std/assert@1";
import {
  resolveCodeHighlightStrategy,
  type StreamingAutoHighlightCache,
} from "../../../src/hlvm/cli/repl-ink/components/markdown/CodeBlock.tsx";

Deno.test("resolveCodeHighlightStrategy prefers explicit languages", () => {
  assertEquals(
    resolveCodeHighlightStrategy("const x = 1;", {
      language: "typescript",
      isPending: true,
    }),
    { kind: "explicit", language: "typescript" },
  );
});

Deno.test("resolveCodeHighlightStrategy reuses cached auto language while the current line grows", () => {
  const cache: StreamingAutoHighlightCache = {
    language: "javascript",
    visibleCode: "const value = foo",
    completeLineCount: 0,
  };

  assertEquals(
    resolveCodeHighlightStrategy("const value = fooBar", {
      isPending: true,
      cache,
    }),
    { kind: "cached-auto", language: "javascript" },
  );
});

Deno.test("resolveCodeHighlightStrategy redetects when a new complete line arrives", () => {
  const cache: StreamingAutoHighlightCache = {
    language: "javascript",
    visibleCode: "const value = foo",
    completeLineCount: 0,
  };

  assertEquals(
    resolveCodeHighlightStrategy("const value = foo\nconsole.log(value)", {
      isPending: true,
      cache,
    }),
    { kind: "auto" },
  );
});

Deno.test("resolveCodeHighlightStrategy redetects after streaming completes", () => {
  const cache: StreamingAutoHighlightCache = {
    language: "javascript",
    visibleCode: "const value = foo",
    completeLineCount: 0,
  };

  assertEquals(
    resolveCodeHighlightStrategy("const value = fooBar", {
      isPending: false,
      cache,
    }),
    { kind: "auto" },
  );
});
