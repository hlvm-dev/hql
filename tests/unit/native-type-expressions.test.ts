import { assertStringIncludes } from "jsr:@std/assert@1";
import { hqlToTypeScript } from "./helpers.ts";

function assertTypeIncludes(hql: string, expected: string[]): void {
  const result = hqlToTypeScript(hql);
  for (const snippet of expected) {
    assertStringIncludes(result, snippet);
  }
}

Deno.test("Native type expressions: aliases support type, deftype, generics, passthrough, and Swift normalization", () => {
  assertTypeIncludes(`
    (type MyString string)
    (type Container<T> T)
    (type Complex "Record<string, number>")
    (deftype MyNumber number)
    (type Flag Bool)
  `, [
    "type MyString = string;",
    "type Container<T> = T;",
    "type Complex = Record<string, number>;",
    "type MyNumber = number;",
    "type Flag = boolean;",
  ]);
});

Deno.test("Native type expressions: unions, intersections, arrays, and precedence render correctly", () => {
  assertTypeIncludes(`
    (type Status (| "pending" "active" "done"))
    (type Combined (& A B))
    (type MixedArray (array (| string number)))
    (type ComplexType (| (& A B) (tuple number string) (array (| C D))))
  `, [
    'type Status = "pending" | "active" | "done";',
    "type Combined = A & B;",
    "type MixedArray = (string | number)[];",
    "type ComplexType = (A & B) | [number, string] | (C | D)[];",
  ]);
});

Deno.test("Native type expressions: keyof, indexed access, and mapped types share one coherent syntax", () => {
  assertTypeIncludes(`
    (type Keys<T> (keyof T))
    (type Value<T> (indexed T (keyof T)))
    (type Readonly<T> (mapped K (keyof T) (indexed T K)))
  `, [
    "type Keys<T> = keyof T;",
    "type Value<T> = T[keyof T];",
    "type Readonly<T> = { [K in keyof T]: T[K] };",
  ]);
});

Deno.test("Native type expressions: conditionals cover infer, typeof, and literal branches", () => {
  assertTypeIncludes(`
    (type UnwrapPromise<T> (if-extends T (Promise (infer U)) U T))
    (type IsZero<T> (if-extends T 0 true false))
    (type MyType (typeof myVar))
    (type MaybeVoid<T> (if-extends T string Void never))
  `, [
    "type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;",
    "type IsZero<T> = T extends 0 ? true : false;",
    "type MyType = typeof myVar;",
    "type MaybeVoid<T> = T extends string ? void : never;",
  ]);
});

Deno.test("Native type expressions: tuples, rest arrays, function types, and readonly compose correctly", () => {
  assertTypeIncludes(`
    (type Args (tuple string (rest (array number))))
    (type Handler (-> [value:number opts?:string] boolean))
    (type ImmutableNumbers (readonly (array number)))
    (type Coord (tuple Double Double))
  `, [
    "type Args = [string, ...number[]];",
    "type Handler = (value: number, opts?: string) => boolean;",
    "type ImmutableNumbers = readonly number[];",
    "type Coord = [number, number];",
  ]);
});

Deno.test("Native type expressions: utility type application stays concise and typed", () => {
  assertTypeIncludes(`
    (type PartialPerson (Partial Person))
    (type PickedPerson (Pick Person (| "name" "age")))
    (type StringRecord (Record string number))
  `, [
    "type PartialPerson = Partial<Person>;",
    'type PickedPerson = Pick<Person, "name" | "age">;',
    "type StringRecord = Record<string, number>;",
  ]);
});
