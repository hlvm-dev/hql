import * as IR from "../../type/hql_ir.ts";
import { FIRST_CLASS_OPERATORS } from "../../keyword/primitives.ts";
import { forEachNode, IR_SKIP_KEYS } from "../../utils/ir-tree-walker.ts";
import {
  buildParameterEffectTable,
  lookupFunctionSignature,
} from "./effect-env.ts";
import type {
  Effect,
  EffectResult,
  SignatureTable,
} from "./effect-types.ts";
import { joinResults, pureResult, impureResult, isSubeffect } from "./effect-lattice.ts";
import {
  getConstructorEffect,
  getFunctionEffect,
  getHigherOrderCallbackPositions,
  getMethodEffect,
  getStaticMemberEffect,
  getTypedMethodEffect,
} from "./effect-signatures.ts";
import type { ValueKind } from "./effect-types.ts";
import { parseValueKind, inferNodeKind } from "./effect-receiver.ts";
import {
  dynamicConstructorMessage,
  dynamicFunctionCallMessage,
  impureConstructorMessage,
  impureFunctionCallMessage,
  inlineFunctionCallMessage,
  mutatingMethodMessage,
  sideEffectMemberCallMessage,
  toEffectValidationError,
  impureCallbackMessage,
  unknownFunctionCallMessage,
  unknownMemberCallMessage,
  unknownMemberMethodMessage,
} from "./effect-errors.ts";


interface InferenceContext {
  fnName: string;
  signatures: SignatureTable;
  paramEffects: ReturnType<typeof buildParameterEffectTable>;
  typeEnv: Map<string, ValueKind>;
  callableAliases: Map<string, Effect>;
  purityRelevantParams?: Set<string>;
}

function identifierName(node: IR.IRNode): string | undefined {
  if (node.type === IR.IRNodeType.Identifier) {
    return (node as IR.IRIdentifier).name;
  }
  return undefined;
}

function memberPath(node: IR.IRNode): string | undefined {
  if (node.type !== IR.IRNodeType.MemberExpression) return undefined;
  const member = node as IR.IRMemberExpression;
  const objectName = identifierName(member.object);
  const propertyName = identifierName(member.property);
  if (!objectName || !propertyName) return undefined;
  return `${objectName}.${propertyName}`;
}

function isCompilerGeneratedFunctionExpression(fnExpr: IR.IRFunctionExpression): boolean {
  if (fnExpr.body.body.length === 0) return false;
  if (
    fnExpr.position?.line !== undefined ||
    fnExpr.position?.column !== undefined ||
    fnExpr.position?.filePath !== undefined
  ) {
    return false;
  }
  return fnExpr.body.body.every((stmt) =>
    stmt.position?.line === undefined &&
    stmt.position?.column === undefined &&
    stmt.position?.filePath === undefined
  );
}

function methodEffectFromNode(
  member: IR.IRMemberExpression | IR.IRCallMemberExpression,
  typeEnv: Map<string, ValueKind>,
): { effect: Effect | undefined; methodName?: string; fullPath?: string } {
  const objectName = identifierName(member.object);
  const propertyName = identifierName(member.property);

  if (objectName && propertyName) {
    const fullPath = `${objectName}.${propertyName}`;
    const staticEffect = getStaticMemberEffect(fullPath);
    if (staticEffect) return { effect: staticEffect, methodName: propertyName, fullPath };

    // Typed method lookup: use receiver's ValueKind if known
    const receiverKind = typeEnv.get(objectName) ?? "Untyped";
    const typedEffect = getTypedMethodEffect(receiverKind, propertyName);
    return { effect: typedEffect, methodName: propertyName, fullPath };
  }

  if (propertyName) {
    return { effect: getMethodEffect(propertyName), methodName: propertyName };
  }

  return { effect: undefined };
}

function inferChildrenEffect(node: IR.IRNode, ctx: InferenceContext): EffectResult {
  let current = pureResult();

  for (const key of Object.keys(node)) {
    if (IR_SKIP_KEYS.has(key)) continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    if (!value || typeof value !== "object") continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (!item || typeof item !== "object") continue;
        if (!("type" in item) || typeof (item as IR.IRNode).type !== "number") continue;
        current = joinResults(current, inferNodeEffect(item as IR.IRNode, ctx));
      }
      continue;
    }

    if (!("type" in value) || typeof (value as IR.IRNode).type !== "number") continue;
    current = joinResults(current, inferNodeEffect(value as IR.IRNode, ctx));
  }

  return current;
}

function inferCalleeEffect(callee: IR.IRNode, ctx: InferenceContext): EffectResult {
  if (callee.type === IR.IRNodeType.Identifier) {
    const name = (callee as IR.IRIdentifier).name;
    const paramInfo = ctx.paramEffects.get(name);
    if (paramInfo) {
      ctx.purityRelevantParams?.add(name);
      if (paramInfo.effect === "Pure") return pureResult();
      if (paramInfo.source === "unannotated-param") {
        return impureResult({
          node: callee,
          message: unknownFunctionCallMessage(ctx.fnName, name),
        });
      }
      return impureResult({
        node: callee,
        message: impureFunctionCallMessage(ctx.fnName, name),
      });
    }

    const aliasEffect = ctx.callableAliases.get(name);
    if (aliasEffect === "Pure") return pureResult();
    if (aliasEffect === "Impure") {
      return impureResult({
        node: callee,
        message: impureFunctionCallMessage(ctx.fnName, name),
      });
    }

    if (FIRST_CLASS_OPERATORS.has(name)) return pureResult();

    const signature = lookupFunctionSignature(name, ctx.signatures);
    if (signature) {
      if (signature.effect === "Pure") return pureResult();
      return impureResult({
        node: callee,
        message: impureFunctionCallMessage(ctx.fnName, name),
      });
    }

    const externFunctionEffect = getFunctionEffect(name);
    if (externFunctionEffect === "Pure") return pureResult();
    if (externFunctionEffect === "Impure") {
      return impureResult({
        node: callee,
        message: sideEffectMemberCallMessage(ctx.fnName, name),
      });
    }

    return impureResult({
      node: callee,
      message: unknownFunctionCallMessage(ctx.fnName, name),
    });
  }

  if (callee.type === IR.IRNodeType.MemberExpression) {
    const member = callee as IR.IRMemberExpression;
    const { effect, methodName, fullPath } = methodEffectFromNode(member, ctx.typeEnv);
    if (effect === "Pure") return pureResult();
    if (effect === "Impure") {
      if (methodName && getMethodEffect(methodName) === "Impure") {
        return impureResult({
          node: callee,
          message: mutatingMethodMessage(ctx.fnName, methodName),
        });
      }
      return impureResult({
        node: callee,
        message: sideEffectMemberCallMessage(ctx.fnName, fullPath ?? methodName ?? "<dynamic>"),
      });
    }

    if (methodName) {
      return impureResult({
        node: callee,
        message: unknownMemberMethodMessage(ctx.fnName, methodName),
      });
    }

    return impureResult({
      node: callee,
      message: unknownMemberCallMessage(ctx.fnName, fullPath ?? "<dynamic>"),
    });
  }

  if (callee.type === IR.IRNodeType.FunctionExpression) {
    const fnExpr = callee as IR.IRFunctionExpression;
    if (isCompilerGeneratedFunctionExpression(fnExpr)) return pureResult();
    return impureResult({
      node: callee,
      message: inlineFunctionCallMessage(ctx.fnName),
    });
  }

  return impureResult({
    node: callee,
    message: dynamicFunctionCallMessage(ctx.fnName),
  });
}

function inferNodeEffect(node: IR.IRNode, ctx: InferenceContext): EffectResult {
  switch (node.type) {
    case IR.IRNodeType.NumericLiteral:
    case IR.IRNodeType.StringLiteral:
    case IR.IRNodeType.BooleanLiteral:
    case IR.IRNodeType.NullLiteral:
    case IR.IRNodeType.Identifier:
      return pureResult();

    case IR.IRNodeType.AssignmentExpression:
      return impureResult({
        node,
        message: `Mutation (assignment) is not allowed in pure function '${ctx.fnName}'`,
      });

    case IR.IRNodeType.AwaitExpression:
      return impureResult({
        node,
        message: `'await' is not allowed in pure function '${ctx.fnName}' (async I/O)`,
      });

    case IR.IRNodeType.YieldExpression:
      return impureResult({
        node,
        message: `'yield' is not allowed in pure function '${ctx.fnName}' (generator effect)`,
      });

    case IR.IRNodeType.ForOfStatement: {
      const forOf = node as IR.IRForOfStatement;
      if (forOf.await) {
        return impureResult({
          node,
          message: `'for-await-of' is not allowed in pure function '${ctx.fnName}' (async iteration)`,
        });
      }
      return inferChildrenEffect(node, ctx);
    }

    case IR.IRNodeType.VariableDeclaration: {
      // Populate typeEnv from let/const bindings for receiver-typed method lookup.
      // Bindings persist in typeEnv for sibling statements in the same block —
      // this is correct because HQL's (let ...) compiles to IIFEs (FunctionExpression
      // nodes, which return pureResult() without traversal), so inner scopes never
      // leak entries. Sequential var/const in the same fx body SHOULD see each other.
      const decl = node as IR.IRVariableDeclaration;
      for (const declarator of decl.declarations) {
        if (declarator.id.type !== IR.IRNodeType.Identifier) continue;
        const varName = (declarator.id as IR.IRIdentifier).name;
        // Prefer explicit type annotation; fall back to init-node inference
        const kind = declarator.typeAnnotation
          ? parseValueKind(declarator.typeAnnotation)
          : declarator.init
            ? inferNodeKind(declarator.init)
            : "Untyped" as ValueKind;
        if (kind !== "Untyped") {
          ctx.typeEnv.set(varName, kind);
        }

        // Track callable aliases for purity checks through indirection.
        const aliasTarget = declarator.init
          ? unwrapCallableAliasInitializer(declarator.init)
          : null;
        if (aliasTarget) {
          const aliasEffect = resolveArgumentCallableEffect(
            aliasTarget,
            ctx.signatures,
            ctx.callableAliases,
          );
          ctx.callableAliases.set(varName, aliasEffect);
        }
      }
      return inferChildrenEffect(node, ctx);
    }

    case IR.IRNodeType.CallExpression: {
      const call = node as IR.IRCallExpression;
      let result = inferCalleeEffect(call.callee, ctx);

      // For pure method calls (e.g. .map, .filter), check callback args for purity
      const methodName = (call.callee.type === IR.IRNodeType.MemberExpression)
        ? identifierName((call.callee as IR.IRMemberExpression).property)
        : undefined;
      const callbackPositions = (result.effect === "Pure" && methodName)
        ? getHigherOrderCallbackPositions(methodName)
        : undefined;

      for (let i = 0; i < call.arguments.length; i++) {
        const arg = call.arguments[i];
        if (callbackPositions?.has(i)) {
          result = joinResults(result, inferCallbackEffect(arg, methodName!, ctx));
        } else {
          result = joinResults(result, inferNodeEffect(arg, ctx));
        }
      }
      return result;
    }

    case IR.IRNodeType.OptionalCallExpression: {
      const call = node as IR.IROptionalCallExpression;
      let result = inferCalleeEffect(call.callee, ctx);

      const optMethodName = (call.callee.type === IR.IRNodeType.OptionalMemberExpression)
        ? identifierName((call.callee as IR.IROptionalMemberExpression).property)
        : undefined;
      const optCallbackPositions = (result.effect === "Pure" && optMethodName)
        ? getHigherOrderCallbackPositions(optMethodName)
        : undefined;

      for (let i = 0; i < call.arguments.length; i++) {
        const arg = call.arguments[i];
        if (optCallbackPositions?.has(i)) {
          result = joinResults(result, inferCallbackEffect(arg, optMethodName!, ctx));
        } else {
          result = joinResults(result, inferNodeEffect(arg, ctx));
        }
      }
      return result;
    }

    case IR.IRNodeType.CallMemberExpression: {
      const call = node as IR.IRCallMemberExpression;
      const { effect, methodName, fullPath } = methodEffectFromNode(call, ctx.typeEnv);
      let memberResult: EffectResult;

      if (effect === "Pure") {
        memberResult = pureResult();
      } else if (effect === "Impure") {
        if (methodName && getMethodEffect(methodName) === "Impure") {
          memberResult = impureResult({
            node,
            message: mutatingMethodMessage(ctx.fnName, methodName),
          });
        } else {
          memberResult = impureResult({
            node,
            message: sideEffectMemberCallMessage(ctx.fnName, fullPath ?? methodName ?? "<dynamic>"),
          });
        }
      } else if (methodName) {
        memberResult = impureResult({
          node,
          message: unknownMemberMethodMessage(ctx.fnName, methodName),
        });
      } else {
        memberResult = impureResult({
          node,
          message: unknownMemberCallMessage(ctx.fnName, fullPath ?? "<dynamic>"),
        });
      }

      let result = memberResult;
      const callbackPositions = (effect === "Pure" && methodName)
        ? getHigherOrderCallbackPositions(methodName)
        : undefined;
      for (let i = 0; i < call.arguments.length; i++) {
        const arg = call.arguments[i];
        if (callbackPositions?.has(i)) {
          result = joinResults(result, inferCallbackEffect(arg, methodName!, ctx));
        } else {
          result = joinResults(result, inferNodeEffect(arg, ctx));
        }
      }
      result = joinResults(result, inferNodeEffect(call.object, ctx));
      return result;
    }

    case IR.IRNodeType.JsMethodAccess: {
      const access = node as IR.IRJsMethodAccess;
      const objectName = identifierName(access.object);
      if (objectName) {
        const fullPath = `${objectName}.${access.method}`;
        const staticEffect = getStaticMemberEffect(fullPath);
        if (staticEffect === "Pure") return pureResult();
        if (staticEffect === "Impure") {
          return impureResult({
            node,
            message: sideEffectMemberCallMessage(ctx.fnName, fullPath),
          });
        }

        // Typed method lookup via typeEnv
        const receiverKind = ctx.typeEnv.get(objectName) ?? "Untyped";
        const typedEffect = getTypedMethodEffect(receiverKind, access.method);
        if (typedEffect === "Pure") return pureResult();
        if (typedEffect === "Impure") {
          return impureResult({
            node,
            message: mutatingMethodMessage(ctx.fnName, access.method),
          });
        }

        // No typed match found — method unknown for this receiver
        if (receiverKind !== "Untyped") {
          return impureResult({
            node,
            message: unknownMemberMethodMessage(ctx.fnName, access.method),
          });
        }
      }

      const methodEffect = getMethodEffect(access.method);
      if (methodEffect === "Pure") return pureResult();
      if (methodEffect === "Impure") {
        return impureResult({
          node,
          message: mutatingMethodMessage(ctx.fnName, access.method),
        });
      }

      return impureResult({
        node,
        message: unknownMemberMethodMessage(ctx.fnName, access.method),
      });
    }

    case IR.IRNodeType.NewExpression: {
      const expr = node as IR.IRNewExpression;
      const ctorName = identifierName(expr.callee);
      if (!ctorName) {
        return impureResult({
          node,
          message: dynamicConstructorMessage(ctx.fnName),
        });
      }
      const ctorEffect = getConstructorEffect(ctorName);
      if (ctorEffect === "Pure") {
        let result = pureResult();
        for (const arg of expr.arguments) {
          result = joinResults(result, inferNodeEffect(arg, ctx));
        }
        return result;
      }
      return impureResult({
        node,
        message: impureConstructorMessage(ctx.fnName, ctorName),
      });
    }

    // Nested function bodies are separate scopes. Defining a function value in a
    // pure body is allowed; invocation is checked at call sites.
    case IR.IRNodeType.FunctionDeclaration:
    case IR.IRNodeType.FnFunctionDeclaration:
    case IR.IRNodeType.FunctionExpression:
      return pureResult();
  }

  return inferChildrenEffect(node, ctx);
}

function describeArgument(node: IR.IRNode): string {
  if (node.type === IR.IRNodeType.Identifier) {
    return (node as IR.IRIdentifier).name;
  }
  if (node.type === IR.IRNodeType.FunctionExpression) {
    return (node as IR.IRFunctionExpression).id?.name ?? "<anonymous fn>";
  }
  if (node.type === IR.IRNodeType.MemberExpression) {
    return memberPath(node) ?? "<expression>";
  }
  return "<expression>";
}

function resolveArgumentCallableEffect(
  arg: IR.IRNode,
  signatures: SignatureTable,
  aliasEffects?: ReadonlyMap<string, Effect>,
): Effect {
  if (arg.type === IR.IRNodeType.FunctionExpression) {
    const fnExpr = arg as IR.IRFunctionExpression;
    if (fnExpr.pure) return "Pure";
    if (isCompilerGeneratedFunctionExpression(fnExpr)) return "Pure";
    // Check body for actual purity (inline fn with pure body is acceptable)
    const ctx: InferenceContext = {
      fnName: fnExpr.id?.name ?? "<anonymous fn>",
      signatures,
      paramEffects: buildParameterEffectTable(
        fnExpr.params,
        fnExpr.id?.name ?? "<anonymous fn>",
        "Impure",
      ),
      typeEnv: new Map(),
      callableAliases: new Map(aliasEffects ? aliasEffects.entries() : []),
    };
    const result = inferNodeEffect(fnExpr.body, ctx);
    return result.effect === "Pure" ? "Pure" : "Impure";
  }

  if (arg.type === IR.IRNodeType.Identifier) {
    const name = (arg as IR.IRIdentifier).name;
    const aliasedEffect = aliasEffects?.get(name);
    if (aliasedEffect) return aliasedEffect;
    const signature = lookupFunctionSignature(name, signatures);
    if (signature) return signature.effect;
    const externEffect = getFunctionEffect(name);
    if (externEffect) return externEffect;
    return "Impure";
  }

  if (arg.type === IR.IRNodeType.MemberExpression) {
    const path = memberPath(arg);
    if (path) {
      const staticEffect = getStaticMemberEffect(path);
      if (staticEffect) return staticEffect;
      const method = path.slice(path.lastIndexOf(".") + 1);
      const methodEffect = getMethodEffect(method);
      if (methodEffect) return methodEffect;
    }
    return "Impure";
  }

  if (arg.type === IR.IRNodeType.JsMethodAccess) {
    const access = arg as IR.IRJsMethodAccess;
    const objectName = identifierName(access.object);
    if (objectName) {
      const staticEffect = getStaticMemberEffect(`${objectName}.${access.method}`);
      if (staticEffect) return staticEffect;
    }
    return getMethodEffect(access.method) ?? "Impure";
  }

  // Non-callable expressions are handled by TypeScript typing; treat as Pure for
  // effect-constraint purposes to avoid duplicate diagnostics.
  return "Pure";
}

/**
 * Infer the effect of a callback argument when it is *invoked* by a
 * higher-order method (e.g. `.map`, `.filter`). Unlike `inferNodeEffect`
 * which treats FunctionExpression/Identifier as pure (evaluating a reference),
 * this checks what happens when the callback actually runs.
 */
function inferCallbackEffect(
  arg: IR.IRNode,
  methodName: string,
  ctx: InferenceContext,
): EffectResult {
  if (arg.type === IR.IRNodeType.FunctionExpression) {
    const fnExpr = arg as IR.IRFunctionExpression;
    // Compiler-generated IIFEs (e.g. from let bindings) are trusted pure
    if (fnExpr.pure || isCompilerGeneratedFunctionExpression(fnExpr)) {
      return pureResult();
    }
    // Check the function BODY for purity — this is the key fix.
    // Build a fresh context for the callback's own scope so its params
    // are properly tracked (e.g. unannotated callback params are fail-closed).
    const cbName = fnExpr.id?.name ?? "<anonymous fn>";
    const cbCtx: InferenceContext = {
      fnName: ctx.fnName,
      signatures: ctx.signatures,
      paramEffects: buildParameterEffectTable(fnExpr.params, cbName, "Impure"),
      typeEnv: new Map(ctx.typeEnv),
      callableAliases: new Map(ctx.callableAliases),
    };
    const bodyResult = inferNodeEffect(fnExpr.body, cbCtx);
    if (bodyResult.effect === "Impure") {
      return impureResult({
        node: arg,
        message: impureCallbackMessage(ctx.fnName, cbName, methodName),
      });
    }
    return pureResult();
  }

  if (arg.type === IR.IRNodeType.Identifier) {
    const name = (arg as IR.IRIdentifier).name;

    // Check parameter effect annotations (e.g. f:(Pure ...))
    const paramInfo = ctx.paramEffects.get(name);
    if (paramInfo) {
      ctx.purityRelevantParams?.add(name);
      if (paramInfo.effect === "Pure") return pureResult();
      return impureResult({
        node: arg,
        message: impureCallbackMessage(ctx.fnName, name, methodName),
      });
    }

    // Check first-class operators (arithmetic, comparison)
    if (FIRST_CLASS_OPERATORS.has(name)) return pureResult();

    const aliasEffect = ctx.callableAliases.get(name);
    if (aliasEffect === "Pure") return pureResult();
    if (aliasEffect === "Impure") {
      return impureResult({
        node: arg,
        message: impureCallbackMessage(ctx.fnName, name, methodName),
      });
    }

    // Check function signatures (other fx functions)
    const signature = lookupFunctionSignature(name, ctx.signatures);
    if (signature) {
      if (signature.effect === "Pure") return pureResult();
      return impureResult({
        node: arg,
        message: impureCallbackMessage(ctx.fnName, name, methodName),
      });
    }

    // Check extern function effects
    const externEffect = getFunctionEffect(name);
    if (externEffect === "Pure") return pureResult();
    if (externEffect === "Impure") {
      return impureResult({
        node: arg,
        message: impureCallbackMessage(ctx.fnName, name, methodName),
      });
    }

    // Unknown identifier — fail-closed
    return impureResult({
      node: arg,
      message: impureCallbackMessage(ctx.fnName, name, methodName),
    });
  }

  // MemberExpression / JsMethodAccess — delegate to existing resolver
  if (
    arg.type === IR.IRNodeType.MemberExpression ||
    arg.type === IR.IRNodeType.JsMethodAccess
  ) {
    const effect = resolveArgumentCallableEffect(
      arg,
      ctx.signatures,
      ctx.callableAliases,
    );
    if (isSubeffect(effect, "Pure")) return pureResult();
    return impureResult({
      node: arg,
      message: impureCallbackMessage(ctx.fnName, describeArgument(arg), methodName),
    });
  }

  // Non-callable expressions (literals, arrays, objects, binary expressions, etc.)
  // are not callbacks — evaluate normally via inferNodeEffect.
  // Methods like .replace can take either a string or callback at the same position.
  return inferNodeEffect(arg, ctx);
}

export function checkPureFunctionBody(
  fnNode: IR.IRFnFunctionDeclaration | IR.IRFunctionExpression,
  signatures: SignatureTable,
  initialAliases?: ReadonlyMap<string, Effect>,
): Set<string> {
  const fnName = fnNode.id?.name ?? "<anonymous fx>";

  // Build type environment from parameter type annotations
  const typeEnv = new Map<string, ValueKind>();
  for (const param of fnNode.params) {
    if (param.type !== IR.IRNodeType.Identifier) continue;
    const id = param as IR.IRIdentifier;
    const plainName = id.name.startsWith("...") ? id.name.slice(3) : id.name;
    if (plainName && id.typeAnnotation) {
      typeEnv.set(plainName, parseValueKind(id.typeAnnotation));
    }
  }

  const purityRelevantParams = new Set<string>();
  const ctx: InferenceContext = {
    fnName,
    signatures,
    paramEffects: buildParameterEffectTable(fnNode.params, fnName, "Pure"),
    typeEnv,
    callableAliases: new Map(initialAliases ? initialAliases.entries() : []),
    purityRelevantParams,
  };

  const result = inferNodeEffect(fnNode.body, ctx);
  if (result.effect === "Impure" && result.violation) {
    throw toEffectValidationError(result.violation.message, result.violation.node);
  }
  return purityRelevantParams;
}

export function checkPureParameterCallSites(
  ir: IR.IRProgram,
  signatures: SignatureTable,
): void {
  const topLevelAliases = buildGlobalCallableAliasEffects(ir, signatures);

  forEachNode(ir, (node) => {
    if (node.type !== IR.IRNodeType.CallExpression) return;
    const call = node as IR.IRCallExpression;
    if (call.callee.type !== IR.IRNodeType.Identifier) return;

    const calleeName = (call.callee as IR.IRIdentifier).name;
    const signature = lookupFunctionSignature(calleeName, signatures);
    if (!signature) return;

    for (let i = 0; i < Math.min(call.arguments.length, signature.params.length); i++) {
      const param = signature.params[i];
      const isCallable = param.effectAnnotation === "Pure"
        || signature.callableParams?.has(param.name);
      if (!isCallable) continue;

      const argument = call.arguments[i];
      const argumentEffect = resolveArgumentCallableEffect(
        argument,
        signatures,
        topLevelAliases,
      );
      if (isSubeffect(argumentEffect, "Pure")) continue;

      throw toEffectValidationError(
        `Argument '${describeArgument(argument)}' is impure but parameter '${param.name}' requires a Pure function`,
        argument,
      );
    }
  });
}

function isCallableAliasTarget(node: IR.IRNode): boolean {
  return node.type === IR.IRNodeType.Identifier ||
    node.type === IR.IRNodeType.FunctionExpression ||
    node.type === IR.IRNodeType.MemberExpression ||
    node.type === IR.IRNodeType.JsMethodAccess;
}

function unwrapCallableAliasInitializer(node: IR.IRNode): IR.IRNode | null {
  if (isCallableAliasTarget(node)) return node;

  // Const bindings are wrapped with __hql_deepFreeze(...) in IR.
  // Preserve callable alias tracking by looking through this wrapper.
  if (node.type === IR.IRNodeType.CallExpression) {
    const call = node as IR.IRCallExpression;
    if (
      call.callee.type === IR.IRNodeType.Identifier &&
      (call.callee as IR.IRIdentifier).name === "__hql_deepFreeze" &&
      call.arguments.length >= 1
    ) {
      const inner = call.arguments[0];
      return isCallableAliasTarget(inner) ? inner : null;
    }
  }

  return null;
}

function registerAliasesFromVariableDeclaration(
  declaration: IR.IRVariableDeclaration,
  aliases: Map<string, Effect>,
  signatures: SignatureTable,
): void {
  for (const declarator of declaration.declarations) {
    if (declarator.id.type !== IR.IRNodeType.Identifier) continue;
    if (!declarator.init) continue;

    const aliasTarget = unwrapCallableAliasInitializer(declarator.init);
    if (!aliasTarget) continue;

    const aliasName = (declarator.id as IR.IRIdentifier).name;
    const aliasEffect = resolveArgumentCallableEffect(
      aliasTarget,
      signatures,
      aliases,
    );
    aliases.set(aliasName, aliasEffect);
  }
}

export function buildGlobalCallableAliasEffects(
  ir: IR.IRProgram,
  signatures: SignatureTable,
): Map<string, Effect> {
  const aliases = new Map<string, Effect>();

  for (const node of ir.body) {
    switch (node.type) {
      case IR.IRNodeType.VariableDeclaration:
        registerAliasesFromVariableDeclaration(
          node as IR.IRVariableDeclaration,
          aliases,
          signatures,
        );
        break;

      case IR.IRNodeType.ExportVariableDeclaration:
        registerAliasesFromVariableDeclaration(
          (node as IR.IRExportVariableDeclaration).declaration,
          aliases,
          signatures,
        );
        break;

      case IR.IRNodeType.ExportNamedDeclaration: {
        const exportDecl = node as IR.IRExportNamedDeclaration;
        if (exportDecl.declaration?.type === IR.IRNodeType.VariableDeclaration) {
          registerAliasesFromVariableDeclaration(
            exportDecl.declaration as IR.IRVariableDeclaration,
            aliases,
            signatures,
          );
        }
        break;
      }
    }
  }

  return aliases;
}
