import {
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "jsr:@std/assert";
import { transpile } from "../../src/hql/transpiler/index.ts";
import hql from "../../mod.ts";
import { getErrorMessage } from "../../src/common/utils.ts";
import { captureConsole } from "./helpers.ts";

interface TypeCheckResult {
  stdout: string;
  stderr: string;
}

async function runTypeChecked(code: string): Promise<TypeCheckResult> {
  const { stderr: transpileErrors } = await captureConsole(
    () => transpile(code),
    ["error"],
  );

  const { stdout, stderr: runtimeErrors } = await captureConsole(async () => {
    try {
      await hql.run(code);
    } catch (error) {
      console.error(getErrorMessage(error));
    }
  }, ["log", "error"]);

  return {
    stdout,
    stderr: [transpileErrors, runtimeErrors].filter(Boolean).join("\n"),
  };
}

function assertNoTypeError(result: TypeCheckResult): void {
  assertEquals(
    result.stderr.includes("Type error"),
    false,
    `Unexpected type error: ${result.stderr}`,
  );
}

Deno.test("type checking: rejects wrong call-site argument types", async () => {
  const result = await runTypeChecked(`
    (fn add [a:number b:number] :number (+ a b))
    (add "hello" "world")
  `);

  assertStringIncludes(result.stderr, "Type error");
  assertMatch(
    result.stderr,
    /string.*not assignable.*number|Argument.*string.*number|Expected.*number.*got.*string/i,
  );
});

Deno.test("type checking: rejects wrong return types", async () => {
  const result = await runTypeChecked(`
    (fn get-num [] -> Int
      "not a number")
    (print (get-num))
  `);

  assertStringIncludes(result.stderr, "Type error");
  assertMatch(
    result.stderr,
    /string.*not assignable.*number|Cannot use.*string.*where.*number/i,
  );
});

Deno.test("type checking: rejects invalid property access and incompatible method returns", async () => {
  const result = await runTypeChecked(`
    (fn bad-length [n:Int] -> Int
      n.length)
    (fn upper [s:String] -> Int
      (.toUpperCase s))
    (print "done")
  `);

  assertStringIncludes(result.stderr, "Type error");
  assertMatch(result.stderr, /length.*does not exist.*number|Property.*length/i);
  assertMatch(
    result.stderr,
    /string.*not assignable.*number|Cannot use.*string.*where.*number/i,
  );
  assertEquals(result.stdout, "done");
});

Deno.test("type checking: accepts correct typed property and method usage", async () => {
  const result = await runTypeChecked(`
    (fn get-length [s:String] -> Int
      s.length)
    (fn upper [s:String] -> String
      (.toUpperCase s))
    (print (get-length "hello"))
    (print (upper "hello"))
  `);

  assertNoTypeError(result);
  assertEquals(result.stdout, "5\nHELLO");
});

Deno.test("type checking: untyped code still surfaces runtime misuse", async () => {
  const result = await runTypeChecked(`
    (let x 5)
    (print (.toUpperCase x))
  `);

  assertStringIncludes(result.stderr, "is not a function");
});

Deno.test("type checking: generics and unions accept valid usage", async () => {
  const result = await runTypeChecked(`
    (fn first-element [arr:Array<String>] -> String
      (or (get arr 0) "default"))
    (fn echo [v:String|Int] -> String|Int
      v)
    (print (first-element ["hello" "world"]))
    (print (echo 42))
    (print (echo "typed"))
  `);

  assertNoTypeError(result);
  assertEquals(result.stdout, "hello\n42\ntyped");
});

Deno.test("type checking: generics and unions reject incompatible values", async () => {
  const result = await runTypeChecked(`
    (fn sum [nums:Array<Int>] -> Int
      (reduce + 0 nums))
    (fn stringify [v:String|Int] -> String
      (str v))
    (sum ["a" "b" "c"])
    (stringify true)
  `);

  assertStringIncludes(result.stderr, "Type error");
});

Deno.test("type checking: Any, Void, and gradual typing avoid false positives", async () => {
  const result = await runTypeChecked(`
    (fn log-msg [msg:String] -> Void
      (print msg))
    (fn identity [x:Any] -> Any x)
    (fn process [typed:Int untyped]
      (+ typed untyped))
    (log-msg "hello")
    (print (identity true))
    (print (process 10 20))
  `);

  assertNoTypeError(result);
  assertEquals(result.stdout, "hello\ntrue\n30");
});
