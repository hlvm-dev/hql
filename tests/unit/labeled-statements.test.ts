// Tests for labeled statements
import { assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile } from "../../src/hql/transpiler/index.ts";

Deno.test("Label: basic labeled while loop", async () => {
  const result = await transpile(`
    (label outer
      (while true
        (console.log "looping")))
  `);
  assertStringIncludes(result.code, "outer:");
  assertStringIncludes(result.code, "while (true)");
});

Deno.test("Label: break to outer label", async () => {
  const result = await transpile(`
    (label outer
      (while true
        (while true
          (when done
            (break outer)))))
  `);
  assertStringIncludes(result.code, "outer:");
  assertStringIncludes(result.code, "break outer");
});

Deno.test("Label: continue to outer label", async () => {
  const result = await transpile(`
    (label outer
      (while (< i 10)
        (while (< j 10)
          (when (=== (mod j 2) 0)
            (continue outer)))))
  `);
  assertStringIncludes(result.code, "outer:");
  assertStringIncludes(result.code, "continue outer");
});

Deno.test("Label: nested labeled loops", async () => {
  const result = await transpile(`
    (label outer
      (while (< i n)
        (label inner
          (while (< j m)
            (when found
              (break outer))
            (when skip
              (continue inner))))))
  `);
  assertStringIncludes(result.code, "outer:");
  assertStringIncludes(result.code, "inner:");
  assertStringIncludes(result.code, "break outer");
  assertStringIncludes(result.code, "continue inner");
});
