// Tests for logical assignment operators (??=, &&=, ||=)
import { assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile } from "../../src/transpiler/index.ts";

// ??= (Nullish coalescing assignment)
Deno.test("??= basic nullish coalescing assignment", async () => {
  const result = await transpile(`
    (??= x 10)
  `);
  assertStringIncludes(result.code, "x ??= 10");
});

Deno.test("??= with expression value", async () => {
  const result = await transpile(`
    (??= config.timeout (getDefaultTimeout))
  `);
  assertStringIncludes(result.code, "??=");
  assertStringIncludes(result.code, "config.timeout");
});

Deno.test("??= in function context", async () => {
  const result = await transpile(`
    (fn initOptions [options]
      (??= options.maxRetries 3)
      (??= options.timeout 5000)
      options)
  `);
  assertStringIncludes(result.code, "options.maxRetries ??= 3");
  assertStringIncludes(result.code, "options.timeout ??= 5000");
});

// &&= (Logical AND assignment)
Deno.test("&&= basic logical AND assignment", async () => {
  const result = await transpile(`
    (&&= x (getValue))
  `);
  assertStringIncludes(result.code, "x &&= getValue()");
});

Deno.test("&&= with member expression", async () => {
  const result = await transpile(`
    (&&= user.isActive false)
  `);
  assertStringIncludes(result.code, "user.isActive &&= false");
});

// ||= (Logical OR assignment)
Deno.test("||= basic logical OR assignment", async () => {
  const result = await transpile(`
    (||= name "default")
  `);
  assertStringIncludes(result.code, 'name ||= "default"');
});

Deno.test("||= with function call", async () => {
  const result = await transpile(`
    (||= cache.data (fetchData))
  `);
  assertStringIncludes(result.code, "cache.data ||= fetchData()");
});

Deno.test("Combined logical assignments", async () => {
  const result = await transpile(`
    (fn processConfig [config]
      (||= config.name "unnamed")
      (??= config.retries 3)
      (&&= config.enabled (validate config))
      config)
  `);
  assertStringIncludes(result.code, '||= "unnamed"');
  assertStringIncludes(result.code, "??= 3");
  assertStringIncludes(result.code, "&&= validate(config)");
});
