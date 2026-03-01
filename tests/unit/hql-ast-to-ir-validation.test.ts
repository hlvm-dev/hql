import { assertThrows } from "jsr:@std/assert@1";
import { ValidationError } from "../../src/common/error.ts";
import { transformHQLNodeToIR } from "../../src/hql/transpiler/pipeline/hql-ast-to-hql-ir.ts";

Deno.test("AST->IR: unknown node types fail fast", () => {
  const unknownNode = {
    type: "mystery-node",
    _meta: { filePath: "<test>", line: 1, column: 1 },
  } as unknown;

  assertThrows(
    () => transformHQLNodeToIR(unknownNode as never, "."),
    ValidationError,
    "Unknown HQL AST node type",
  );
});
