import * as IR from "../type/hql_ir.ts";
import { forEachNode } from "../utils/ir-tree-walker.ts";
import { buildSignatureTable, lookupFunctionSignature } from "./effects/effect-env.ts";
import {
  checkPureFunctionBody,
  checkPureParameterCallSites,
} from "./effects/effect-infer.ts";
import { toEffectValidationError } from "./effects/effect-errors.ts";

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
      // Generators are inherently impure — reject at declaration level
      if (fn.generator) {
        throw toEffectValidationError(
          `Generator function '${fn.id.name}' cannot be declared pure (fx). Generators use 'yield' which is an effect.`,
          fn,
        );
      }
      const callableParams = checkPureFunctionBody(fn, signatures);
      const sig = lookupFunctionSignature(fn.id.name, signatures);
      if (sig) sig.callableParams = callableParams;
      return;
    }

    if (node.type === IR.IRNodeType.FunctionExpression) {
      const fnExpr = node as IR.IRFunctionExpression;
      if (!fnExpr.pure) return;
      const callableParams = checkPureFunctionBody(fnExpr, signatures);
      if (fnExpr.id) {
        const sig = lookupFunctionSignature(fnExpr.id.name, signatures);
        if (sig) sig.callableParams = callableParams;
      }
    }
  });

  checkPureParameterCallSites(ir, signatures);
}
