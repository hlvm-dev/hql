import {
  assertEquals,
  assertExists,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert";
import { findSymbolByName } from "./helpers.ts";
import { macroexpand } from "../../mod.ts";
import { expandHql } from "../../src/hql/transpiler/hql-transpiler.ts";
import { ValidationError } from "../../src/common/error.ts";
import {
  getMeta,
  type SExp,
} from "../../src/hql/s-exp/types.ts";
import { transformToIR } from "../../src/hql/transpiler/pipeline/hql-ast-to-hql-ir.ts";

Deno.test("macro args stay as raw forms by default", async () => {
  const [expanded] = await macroexpand(`(do
    (macro arg-head [form]
      (if (list? form)
          (name (%first form))
          "not-list"))
    (arg-head (+ 1 2)))`);

  assertEquals(expanded, `(do "+")`);
});

Deno.test("%eval explicitly evaluates a raw macro form", async () => {
  const [expanded] = await macroexpand(`(do
    (macro eval-now [form]
      (%eval form))
    (eval-now (+ 1 2)))`);

  assertEquals(expanded, `(do 3)`);
});

Deno.test("syntax-quote attaches resolved binding metadata while quasiquote stays raw", async () => {
  const [syntaxExpanded] = await expandHql(`(do
    (macro syntax []
      \`(+ 1 2))
    (syntax))`);
  const syntaxPlus = findSymbolByName(syntaxExpanded, "+");
  assertExists(syntaxPlus);
  assertEquals(getMeta(syntaxPlus)?.resolvedBinding?.modulePath, "<builtin>");

  const [quasiExpanded] = await expandHql(`(do
    (macro raw []
      (quasiquote (+ 1 2)))
    (raw))`);
  const quasiPlus = findSymbolByName(quasiExpanded, "+");
  assertExists(quasiPlus);
  assertEquals(getMeta(quasiPlus)?.resolvedBinding, undefined);
});

Deno.test("syntax-quote preserves local binding identity metadata", async () => {
  const [expanded] = await expandHql(`(do
    (macro bind-local [value]
      (let (alias value)
        \`(list alias ~alias)))
    (bind-local foo))`);

  const alias = findSymbolByName(expanded, "alias");
  assertExists(alias);
  assertEquals(getMeta(alias)?.resolvedBinding?.kind, "local");
  assertExists(getMeta(alias)?.resolvedBinding?.lexicalId);
});

Deno.test("&form, &env, and macro destructuring are available in macro params", async () => {
  const [formExpanded] = await macroexpand(
    `(do
      (macro inspect-form [&form expr]
        (name (%first &form)))
      (inspect-form (+ 1 2)))`,
  );
  assertEquals(formExpanded, `(do "inspect-form")`);

  const [envExpanded] = await macroexpand(
    `(do
      (macro inspect-env [&env]
        (get &env "currentFile"))
      (inspect-env))`,
    { currentFile: "/tmp/macro-env-test.hql" },
  );
  assertEquals(envExpanded, `(do "/tmp/macro-env-test.hql")`);

  const [vectorExpanded] = await macroexpand(`(do
    (macro swap [[a b]]
      \`[~b ~a])
    (swap [1 2]))`);
  assertEquals(vectorExpanded, `(do (vector 2 1))`);

  const [mapExpanded] = await macroexpand(`(do
    (macro sum-fields [{x: x y: y}]
      \`(+ ~x ~y))
    (sum-fields {x: 1 y: 2}))`);
  assertEquals(mapExpanded, `(do (+ 1 2))`);
});

Deno.test("outer macros receive nested macro calls as raw forms", async () => {
  const [expanded] = await macroexpand(`(do
    (macro inner []
      \`(+ 1 2))
    (macro outer [form]
      (if (list? form)
          (name (%first form))
          "not-list"))
    (outer (inner)))`);

  assertEquals(expanded, `(do "inner")`);
});

Deno.test("%macroexpand-1 explicitly expands nested macro forms inside macro bodies", async () => {
  const [expanded] = await macroexpand(`(do
    (macro inner []
      \`(+ 1 2))
    (macro outer [form]
      (name (%first (%macroexpand-1 form))))
    (outer (inner)))`);

  assertEquals(expanded, `(do "+")`);
});

Deno.test("resolved module bindings fail closed when the target cannot be found", () => {
  const missingModulePath = "<missing-binding-test>";

  const error = assertThrows(
    () =>
      transformToIR(
        [{
          type: "symbol",
          name: "missing-symbol",
          _meta: {
            resolvedBinding: {
              kind: "module",
              exportName: "missing-symbol",
              modulePath: missingModulePath,
            },
          },
        }],
        "/tmp",
      ),
    ValidationError,
  );

  assertStringIncludes(
    error.message,
    "Resolved module binding 'missing-symbol' from '<missing-binding-test>' could not be found",
  );
});
