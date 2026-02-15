import * as IR from "../../type/hql_ir.ts";
import { getFnFunction } from "../../syntax/function.ts";
import { forEachNode } from "../../utils/ir-tree-walker.ts";
import type {
  FunctionSignature,
  ParameterEffectInfo,
  SignatureTable,
} from "./effect-types.ts";

function toFunctionSignature(
  name: string,
  pure: boolean,
  params: (IR.IRIdentifier | IR.IRArrayPattern | IR.IRObjectPattern)[],
): FunctionSignature {
  return {
    name,
    effect: pure ? "Pure" : "Impure",
    params: params.map((param) => {
      if (param.type !== IR.IRNodeType.Identifier) {
        return { name: "<pattern>" };
      }
      const id = param as IR.IRIdentifier;
      return {
        name: id.name,
        effectAnnotation: id.effectAnnotation,
      };
    }),
  };
}

export function buildSignatureTable(ir: IR.IRProgram): SignatureTable {
  const table: SignatureTable = new Map();

  forEachNode(ir, (node) => {
    if (node.type === IR.IRNodeType.FnFunctionDeclaration) {
      const fn = node as IR.IRFnFunctionDeclaration;
      if (!fn.id?.name) return;
      table.set(fn.id.name, toFunctionSignature(fn.id.name, fn.pure === true, fn.params));
      return;
    }

    if (node.type === IR.IRNodeType.FunctionExpression) {
      const fnExpr = node as IR.IRFunctionExpression;
      if (!fnExpr.id?.name) return;
      table.set(
        fnExpr.id.name,
        toFunctionSignature(fnExpr.id.name, fnExpr.pure === true, fnExpr.params),
      );
    }
  });

  return table;
}

function lookupRegistrySignature(name: string): FunctionSignature | undefined {
  const registryEntry = getFnFunction(name) ?? getFnFunction(name.replace(/_/g, "-"));
  if (!registryEntry) return undefined;

  return toFunctionSignature(
    registryEntry.id?.name ?? name,
    registryEntry.pure === true,
    registryEntry.params,
  );
}

export function lookupFunctionSignature(
  name: string,
  signatures: SignatureTable,
): FunctionSignature | undefined {
  const direct = signatures.get(name);
  if (direct) return direct;
  return lookupRegistrySignature(name);
}

export function buildParameterEffectTable(
  params: (IR.IRIdentifier | IR.IRArrayPattern | IR.IRObjectPattern)[],
  selfName: string,
): Map<string, ParameterEffectInfo> {
  const table = new Map<string, ParameterEffectInfo>();
  table.set(selfName, { effect: "Pure", source: "self" });

  for (const param of params) {
    if (param.type !== IR.IRNodeType.Identifier) continue;

    const id = param as IR.IRIdentifier;
    const plainName = id.name.startsWith("...") ? id.name.slice(3) : id.name;
    if (!plainName) continue;

    if (id.effectAnnotation === "Pure") {
      table.set(plainName, { effect: "Pure", source: "annotated-param" });
      continue;
    }

    if (id.effectAnnotation === "Impure") {
      table.set(plainName, { effect: "Impure", source: "annotated-param" });
      continue;
    }

    table.set(plainName, { effect: "Pure", source: "unannotated-param" });
  }

  return table;
}
