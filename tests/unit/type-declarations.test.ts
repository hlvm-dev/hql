import { assertStringIncludes } from "jsr:@std/assert";
import { hqlToTypeScript } from "./helpers.ts";

function assertTypeScriptSnippets(
  code: string,
  expectedSnippets: readonly string[],
): void {
  const result = hqlToTypeScript(code);
  for (const snippet of expectedSnippets) {
    assertStringIncludes(result, snippet);
  }
}

Deno.test("Type declarations: core type aliases emit valid TypeScript", () => {
  const cases = [
    {
      code: `(deftype MyString "string")`,
      expected: ["type MyString = string;"],
    },
    {
      code: `(deftype StringOrNumber "string | number")`,
      expected: ["type StringOrNumber = string | number;"],
    },
    {
      code: `(deftype Container<T> "{ value: T }")`,
      expected: ["type Container<T> = { value: T };"],
    },
    {
      code: `(deftype "Pair<A, B>" "{ first: A; second: B }")`,
      expected: ["type Pair<A, B> = { first: A; second: B };"],
    },
  ] as const;

  for (const { code, expected } of cases) {
    assertTypeScriptSnippets(code, expected);
  }
});

Deno.test("Type declarations: core interfaces emit valid TypeScript", () => {
  const cases = [
    {
      code: `(interface Person "{ name: string; age: number }")`,
      expected: ["interface Person { name: string; age: number }"],
    },
    {
      code: `(interface Greeter "{ greet(): string; sayHello(name: string): void }")`,
      expected: ["interface Greeter { greet(): string; sayHello(name: string): void }"],
    },
    {
      code: `(interface Box<T> "{ value: T; getValue(): T }")`,
      expected: ["interface Box<T> { value: T; getValue(): T }"],
    },
    {
      code: `(interface Employee extends Person Serializable "{ readonly department: string; salary?: number }")`,
      expected: [
        "interface Employee extends Person, Serializable { readonly department: string; salary?: number }",
      ],
    },
  ] as const;

  for (const { code, expected } of cases) {
    assertTypeScriptSnippets(code, expected);
  }
});
