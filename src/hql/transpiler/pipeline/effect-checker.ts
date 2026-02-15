import * as IR from "../type/hql_ir.ts";
import { forEachNode } from "../utils/ir-tree-walker.ts";
import { buildSignatureTable } from "./effects/effect-env.ts";
import {
  checkPureFunctionBody,
  checkPureParameterCallSites,
} from "./effects/effect-infer.ts";

/**
 * Check HQL effects.
 *
 * Formal source of truth for fx purity:
 * - infer purity for each pure function body and reject impure effects
 * - enforce call-site purity constraints for (Pure ...) callback parameters
 */
export function checkEffects(ir: IR.IRProgram): void {
  const signatures = buildSignatureTable(ir);

  forEachNode(ir, (node) => {
    if (node.type === IR.IRNodeType.FnFunctionDeclaration) {
      const fn = node as IR.IRFnFunctionDeclaration;
      if (!fn.pure) return;
      checkPureFunctionBody(fn, signatures);
      return;
    }

    if (node.type === IR.IRNodeType.FunctionExpression) {
      const fnExpr = node as IR.IRFunctionExpression;
      if (!fnExpr.pure) return;
      checkPureFunctionBody(fnExpr, signatures);
    }
  });

  checkPureParameterCallSites(ir, signatures);
}
