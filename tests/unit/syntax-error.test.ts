import { assertEquals } from "jsr:@std/assert";
import { run } from "./helpers.ts";

const runRuntime = (code: string) => run(code, { typeCheck: false });

Deno.test("error syntax: throw propagates arbitrary values into catch blocks", async () => {
  const result = await run(`
    [
      (try (throw "simple error") (catch e e))
      (try (throw 404) (catch e e))
      (try
        (do
          (range 5)
          (throw "boom"))
        (catch e e))
    ]
  `);

  assertEquals(result, ["simple error", 404, "boom"]);
});

Deno.test("error syntax: try/catch returns the try value when no error occurs", async () => {
  const result = await run(`
    [
      (try 42 (catch e 0))
      (try (+ 10 20) (catch e 0))
    ]
  `);

  assertEquals(result, [42, 30]);
});

Deno.test("error syntax: finally runs on both success and failure without replacing the result", async () => {
  const result = await run(`
    (var successCleanup false)
    (var errorCleanup false)
    [
      (try
        "success"
        (finally
          (= successCleanup true)))
      (try
        (throw "error")
        (catch e
          (+ "Caught: " e))
        (finally
          (= errorCleanup true)))
      successCleanup
      errorCleanup
    ]
  `);

  assertEquals(result, ["success", "Caught: error", true, true]);
});

Deno.test("error syntax: nested handlers can catch locally or rethrow to outer scopes", async () => {
  const result = await run(`
    [
      (try
        (try
          (throw "inner error")
          (catch e
            (+ "Inner: " e)))
        (catch outer
          (+ "Outer: " outer)))
      (try
        (try
          (throw "propagated")
          (catch e
            (throw (+ "Modified: " e))))
        (catch final
          final))
    ]
  `);

  assertEquals(result, ["Inner: inner error", "Modified: propagated"]);
});

Deno.test("error syntax: errors can cross function boundaries and still be handled outside", async () => {
  const result = await runRuntime(`
    (fn thrower []
      (try
        (throw "error from function")
        (catch inner
          (throw inner))))
    (try
      (thrower)
      (catch e
        (+ "Caught: " e)))
  `);

  assertEquals(result, "Caught: error from function");
});
