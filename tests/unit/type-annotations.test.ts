import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { transpile } from "../../src/hql/transpiler/index.ts";

async function runCli(code: string): Promise<string> {
  const proc = new Deno.Command("deno", {
    args: ["run", "--allow-all", "src/hlvm/cli/cli.ts", "run", "-e", code],
    stdout: "piped",
    stderr: "piped",
    cwd: Deno.cwd(),
  });

  const { stdout, stderr } = await proc.output();
  const output = new TextDecoder().decode(stdout).trim();
  const errors = new TextDecoder().decode(stderr);
  if (errors.trim().length > 0) {
    // Runtime errors should fail these tests explicitly.
    throw new Error(errors.trim());
  }
  return output;
}

Deno.test("type annotations: parameter, return, and combined annotations parse and transpile", async () => {
  const backwardCompat = await transpile(
    `(fn add [a:number b:number] (+ a b))`,
    { currentFile: "test.hql" },
  );
  const returnType = await transpile(
    `(fn add [a b] -> Int (+ a b))`,
    { currentFile: "test.hql" },
  );
  const combined = await transpile(
    `(fn add [a:Int b:Int] -> Int (+ a b))`,
    { currentFile: "test.hql" },
  );

  assertStringIncludes(backwardCompat.code, "function add");
  assertStringIncludes(returnType.code, "function add");
  assertStringIncludes(combined.code, "function add");
});

Deno.test("type annotations: anonymous functions and mixed typed-untyped params transpile", async () => {
  const anonymous = await transpile(
    `(const double (fn [x:Int] -> Int (* x 2)))`,
    { currentFile: "test.hql" },
  );
  const mixed = await transpile(
    `(fn mixed [a:String b] (str a " " b))`,
    { currentFile: "test.hql" },
  );

  assertStringIncludes(anonymous.code, "double");
  assertStringIncludes(anonymous.code, "(x) =>");
  assertStringIncludes(mixed.code, "function mixed");
});

Deno.test("type annotations: string, bool, generic, union, and optional syntax transpile", async () => {
  const stringFn = await transpile(
    `(fn greet [name:String] -> String (str "Hello, " name))`,
    { currentFile: "test.hql" },
  );
  const boolFn = await transpile(
    `(fn evenCheck [n:Int] -> Bool (=== 0 (mod n 2)))`,
    { currentFile: "test.hql" },
  );
  const genericFn = await transpile(
    `(fn echoArray [arr:Array<Int>] -> Array<Int> arr)`,
    { currentFile: "test.hql" },
  );
  const unionFn = await transpile(
    `(fn maybe [x:Int|String] x)`,
    { currentFile: "test.hql" },
  );
  const optionalFn = await transpile(
    `(fn optional [x:Int?] x)`,
    { currentFile: "test.hql" },
  );

  assertStringIncludes(stringFn.code, "function greet");
  assertStringIncludes(boolFn.code, "function evenCheck");
  assertStringIncludes(genericFn.code, "function echoArray");
  assertStringIncludes(unionFn.code, "function maybe");
  assertStringIncludes(optionalFn.code, "function optional");
});

Deno.test("type annotations: typed code executes correctly through the CLI", async () => {
  const output = await runCli(`
    (fn add [a:Int b:Int] -> Int (+ a b))
    (fn calculate [x:Int y:Int] -> Int (+ (* x 2) (* y 3)))
    (fn square [x:Int] -> Int (* x x))
    (fn double [x:Int] -> Int (* x 2))
    (print (add 5 7))
    (print (calculate 4 5))
    (print (+ (square 3) (double 5)))
  `);

  assertEquals(output, "12\n23\n19");
});

Deno.test("type annotations: untyped backward-compatible code still executes normally", async () => {
  const output = await runCli(`
    (fn add [a b] (+ a b))
    (fn sub [a b] (- a b))
    (print (add 10 5))
    (print (sub 10 5))
  `);

  assertEquals(output, "15\n5");
});
