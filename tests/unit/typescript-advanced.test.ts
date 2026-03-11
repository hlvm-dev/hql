import { assertStringIncludes } from "jsr:@std/assert";
import { hqlToTypeScript } from "./helpers.ts";

function assertSnippets(code: string, snippets: readonly string[]): void {
  const result = hqlToTypeScript(code);
  for (const snippet of snippets) {
    assertStringIncludes(result, snippet);
  }
}

Deno.test("TypeScript advanced: advanced type aliases are preserved", () => {
  const cases = [
    {
      code: `(deftype PersonKeys "keyof Person")`,
      expected: ["type PersonKeys = keyof Person;"],
    },
    {
      code: `(deftype IsString<T> "T extends string ? true : false")`,
      expected: ["type IsString<T> = T extends string ? true : false;"],
    },
    {
      code: `(deftype EventName "\`on\${string}\`")`,
      expected: ["type EventName = `on${string}`;"],
    },
    {
      code: `(deftype "UnpackPromise<T>" "T extends Promise<infer U> ? U : T")`,
      expected: ["type UnpackPromise<T> = T extends Promise<infer U> ? U : T;"],
    },
  ] as const;

  for (const { code, expected } of cases) {
    assertSnippets(code, expected);
  }
});

Deno.test("TypeScript advanced: abstract classes and overloads emit expected signatures", () => {
  assertSnippets(
    `
      (abstract-class Container<T> [
        (abstract-method getValue [] :T)
        (abstract-method setValue "value: T" :void)
      ])
      (fn-overload process "x: string" :string)
      (fn-overload process "x: number" :number)
    `,
    [
      "abstract class Container<T>",
      "abstract getValue(): T;",
      "abstract setValue(value: T): void;",
      "function process(x: string): string;",
      "function process(x: number): number;",
    ],
  );
});

Deno.test("TypeScript advanced: ambient declarations and namespaces are preserved", () => {
  assertSnippets(
    `
      (declare function "greet(name: string): string")
      (declare const "PI: 3.14159")
      (namespace Models [
        (interface User "{ id: string; name: string }")
      ])
    `,
    [
      "declare function greet(name: string): string;",
      "declare const PI: 3.14159;",
      "namespace Models",
      "interface User",
    ],
  );
});

Deno.test("TypeScript advanced: const enums keep assigned values", () => {
  assertSnippets(
    `(const-enum Status [(OK 200) (NotFound 404) (Error 500)])`,
    [
      "const enum Status",
      "OK = 200",
      "NotFound = 404",
      "Error = 500",
    ],
  );
});

Deno.test("TypeScript advanced: advanced interface forms are emitted", () => {
  assertSnippets(
    `
      (interface StringMap "{ [key: string]: string }")
      (interface Callable "{ (x: number): number }")
      (interface Constructor "{ new (name: string): Person }")
    `,
    [
      "interface StringMap { [key: string]: string }",
      "interface Callable { (x: number): number }",
      "interface Constructor { new (name: string): Person }",
    ],
  );
});

Deno.test("TypeScript advanced: utility and predicate types are preserved", () => {
  assertSnippets(
    `
      (deftype IsStringGuard "(x: unknown) => x is string")
      (deftype AssertString "(x: unknown) => asserts x is string")
      (deftype PartialPerson "Partial<Person>")
      (deftype FnReturn "ReturnType<typeof myFunction>")
    `,
    [
      "type IsStringGuard = (x: unknown) => x is string;",
      "type AssertString = (x: unknown) => asserts x is string;",
      "type PartialPerson = Partial<Person>;",
      "type FnReturn = ReturnType<typeof myFunction>;",
    ],
  );
});

Deno.test("TypeScript advanced: core edge types remain intact", () => {
  assertSnippets(
    `
      (deftype Empty "never")
      (deftype Anything "unknown")
      (deftype NoReturn "void")
    `,
    [
      "type Empty = never;",
      "type Anything = unknown;",
      "type NoReturn = void;",
    ],
  );
});
