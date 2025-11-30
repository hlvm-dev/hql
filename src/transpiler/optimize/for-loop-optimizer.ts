// optimize/for-loop-optimizer.ts
// IR optimization pass to detect __hql_for_each patterns and convert to native for loops

import * as IR from "../type/hql_ir.ts";

/**
 * Optimize __hql_for_each patterns to native for loops.
 *
 * Entry point that takes a Program IR and optimizes it.
 */
export function optimizeForLoops(program: IR.IRProgram): IR.IRProgram {
  return {
    ...program,
    body: program.body.map(optimizeForLoopsNode)
  };
}

/**
 * Optimize a single IR node recursively.
 */
function optimizeForLoopsNode(node: IR.IRNode): IR.IRNode {
  // Recursively optimize children first
  node = optimizeChildren(node);

  // Check if this node is a __hql_for_each call
  if (node.type === IR.IRNodeType.ExpressionStatement) {
    const exprStmt = node as IR.IRExpressionStatement;
    if (exprStmt.expression.type === IR.IRNodeType.CallExpression) {
      const optimized = tryOptimizeForEachCall(exprStmt.expression as IR.IRCallExpression);
      if (optimized) {
        // Statement position: replace ExpressionStatement with ForStatement directly
        return optimized;
      }
    }
  } else if (node.type === IR.IRNodeType.CallExpression) {
    const optimized = tryOptimizeForEachCall(node as IR.IRCallExpression);
    if (optimized) {
      // Expression position: wrap ForStatement in IIFE that returns null
      // This converts: __hql_for_each(...)
      // Into: (() => { for(...) {...}; return null; })()
      return wrapForStatementInIIFE(optimized, node.position);
    }
  }

  return node;
}

/**
 * Recursively optimize all children of a node
 */
function optimizeChildren(node: IR.IRNode): IR.IRNode {
  switch (node.type) {
    case IR.IRNodeType.BlockStatement: {
      const block = node as IR.IRBlockStatement;
      const optimizedBlock: IR.IRBlockStatement = {
        type: IR.IRNodeType.BlockStatement,
        body: block.body.map(optimizeForLoopsNode),
        position: block.position
      };
      return optimizedBlock;
    }

    case IR.IRNodeType.FunctionExpression: {
      const func = node as IR.IRFunctionExpression;
      const optimizedFunc: IR.IRFunctionExpression = {
        ...func,
        body: optimizeForLoopsNode(func.body) as IR.IRBlockStatement,
        position: func.position
      };
      return optimizedFunc;
    }

    case IR.IRNodeType.FunctionDeclaration: {
      const func = node as IR.IRFunctionDeclaration;
      const optimizedFunc: IR.IRFunctionDeclaration = {
        ...func,
        body: optimizeForLoopsNode(func.body) as IR.IRBlockStatement,
        position: func.position
      };
      return optimizedFunc;
    }

    case IR.IRNodeType.FnFunctionDeclaration: {
      const func = node as IR.IRFnFunctionDeclaration;
      const optimizedFunc: IR.IRFnFunctionDeclaration = {
        ...func,
        body: optimizeForLoopsNode(func.body) as IR.IRBlockStatement,
        position: func.position
      };
      return optimizedFunc;
    }

    case IR.IRNodeType.IfStatement: {
      const ifStmt = node as IR.IRIfStatement;
      const optimizedIf: IR.IRIfStatement = {
        type: IR.IRNodeType.IfStatement,
        test: ifStmt.test,
        consequent: optimizeForLoopsNode(ifStmt.consequent),
        alternate: ifStmt.alternate ? optimizeForLoopsNode(ifStmt.alternate) : null,
        position: ifStmt.position
      };
      return optimizedIf;
    }

    case IR.IRNodeType.WhileStatement: {
      const whileStmt = node as IR.IRWhileStatement;
      const optimizedWhile: IR.IRWhileStatement = {
        type: IR.IRNodeType.WhileStatement,
        test: whileStmt.test,
        body: optimizeForLoopsNode(whileStmt.body) as IR.IRBlockStatement,
        position: whileStmt.position
      };
      return optimizedWhile;
    }

    case IR.IRNodeType.TryStatement: {
      const tryStmt = node as IR.IRTryStatement;
      const optimizedTry: IR.IRTryStatement = {
        type: IR.IRNodeType.TryStatement,
        block: optimizeForLoopsNode(tryStmt.block) as IR.IRBlockStatement,
        handler: tryStmt.handler ? {
          type: IR.IRNodeType.CatchClause,
          param: tryStmt.handler.param,
          body: optimizeForLoopsNode(tryStmt.handler.body) as IR.IRBlockStatement,
          position: tryStmt.handler.position
        } : null,
        finalizer: tryStmt.finalizer ? optimizeForLoopsNode(tryStmt.finalizer) as IR.IRBlockStatement : null,
        position: tryStmt.position
      };
      return optimizedTry;
    }

    case IR.IRNodeType.VariableDeclaration: {
      const varDecl = node as IR.IRVariableDeclaration;
      const optimizedVarDecl: IR.IRVariableDeclaration = {
        type: IR.IRNodeType.VariableDeclaration,
        kind: varDecl.kind,
        declarations: varDecl.declarations.map(decl => {
          const optimizedDecl: IR.IRVariableDeclarator = {
            type: IR.IRNodeType.VariableDeclarator,
            id: decl.id,
            init: optimizeForLoopsNode(decl.init),
            position: decl.position
          };
          return optimizedDecl;
        }),
        position: varDecl.position
      };
      return optimizedVarDecl;
    }

    case IR.IRNodeType.ReturnStatement: {
      const ret = node as IR.IRReturnStatement;
      const optimizedRet: IR.IRReturnStatement = {
        type: IR.IRNodeType.ReturnStatement,
        argument: optimizeForLoopsNode(ret.argument),
        position: ret.position
      };
      return optimizedRet;
    }

    case IR.IRNodeType.ExpressionStatement: {
      const exprStmt = node as IR.IRExpressionStatement;
      const optimizedExprStmt: IR.IRExpressionStatement = {
        type: IR.IRNodeType.ExpressionStatement,
        expression: optimizeForLoopsNode(exprStmt.expression),
        position: exprStmt.position
      };
      return optimizedExprStmt;
    }

    case IR.IRNodeType.CallExpression: {
      const call = node as IR.IRCallExpression;
      const optimizedCall: IR.IRCallExpression = {
        type: IR.IRNodeType.CallExpression,
        callee: optimizeForLoopsNode(call.callee) as IR.IRIdentifier | IR.IRMemberExpression | IR.IRFunctionExpression,
        arguments: call.arguments.map(optimizeForLoopsNode),
        position: call.position
      };
      return optimizedCall;
    }

    case IR.IRNodeType.ArrayExpression: {
      const arr = node as IR.IRArrayExpression;
      const optimizedArr: IR.IRArrayExpression = {
        type: IR.IRNodeType.ArrayExpression,
        elements: arr.elements.map(optimizeForLoopsNode),
        position: arr.position
      };
      return optimizedArr;
    }

    case IR.IRNodeType.ConditionalExpression: {
      const cond = node as IR.IRConditionalExpression;
      const optimizedCond: IR.IRConditionalExpression = {
        type: IR.IRNodeType.ConditionalExpression,
        test: optimizeForLoopsNode(cond.test),
        consequent: optimizeForLoopsNode(cond.consequent),
        alternate: optimizeForLoopsNode(cond.alternate),
        position: cond.position
      };
      return optimizedCond;
    }

    case IR.IRNodeType.BinaryExpression: {
      const binary = node as IR.IRBinaryExpression;
      const optimizedBinary: IR.IRBinaryExpression = {
        type: IR.IRNodeType.BinaryExpression,
        operator: binary.operator,
        left: optimizeForLoopsNode(binary.left),
        right: optimizeForLoopsNode(binary.right),
        position: binary.position
      };
      return optimizedBinary;
    }

    case IR.IRNodeType.UnaryExpression: {
      const unary = node as IR.IRUnaryExpression;
      const optimizedUnary: IR.IRUnaryExpression = {
        type: IR.IRNodeType.UnaryExpression,
        operator: unary.operator,
        argument: optimizeForLoopsNode(unary.argument),
        prefix: unary.prefix,
        position: unary.position
      };
      return optimizedUnary;
    }

    case IR.IRNodeType.AssignmentExpression: {
      const assign = node as IR.IRAssignmentExpression;
      const optimizedAssign: IR.IRAssignmentExpression = {
        type: IR.IRNodeType.AssignmentExpression,
        operator: assign.operator,
        left: optimizeForLoopsNode(assign.left),
        right: optimizeForLoopsNode(assign.right),
        position: assign.position
      };
      return optimizedAssign;
    }

    case IR.IRNodeType.ObjectExpression: {
      const obj = node as IR.IRObjectExpression;
      const optimizedObj: IR.IRObjectExpression = {
        type: IR.IRNodeType.ObjectExpression,
        properties: obj.properties.map(prop => {
          if (prop.type === IR.IRNodeType.ObjectProperty) {
            const objProp = prop as IR.IRObjectProperty;
            return {
              type: IR.IRNodeType.ObjectProperty,
              key: optimizeForLoopsNode(objProp.key),
              value: optimizeForLoopsNode(objProp.value),
              computed: objProp.computed,
              position: objProp.position
            } as IR.IRObjectProperty;
          } else if (prop.type === IR.IRNodeType.SpreadAssignment) {
            const spread = prop as IR.IRSpreadAssignment;
            return {
              type: IR.IRNodeType.SpreadAssignment,
              expression: optimizeForLoopsNode(spread.expression),
              position: spread.position
            } as IR.IRSpreadAssignment;
          }
          return prop;
        }),
        position: obj.position
      };
      return optimizedObj;
    }

    case IR.IRNodeType.MemberExpression: {
      const member = node as IR.IRMemberExpression;
      const optimizedMember: IR.IRMemberExpression = {
        type: IR.IRNodeType.MemberExpression,
        object: optimizeForLoopsNode(member.object),
        property: optimizeForLoopsNode(member.property),
        computed: member.computed,
        position: member.position
      };
      return optimizedMember;
    }

    case IR.IRNodeType.CallMemberExpression: {
      const callMember = node as IR.IRCallMemberExpression;
      const optimizedCallMember: IR.IRCallMemberExpression = {
        type: IR.IRNodeType.CallMemberExpression,
        object: optimizeForLoopsNode(callMember.object),
        property: callMember.property,
        arguments: callMember.arguments.map(optimizeForLoopsNode),
        position: callMember.position
      };
      return optimizedCallMember;
    }

    case IR.IRNodeType.NewExpression: {
      const newExpr = node as IR.IRNewExpression;
      const optimizedNew: IR.IRNewExpression = {
        type: IR.IRNodeType.NewExpression,
        callee: optimizeForLoopsNode(newExpr.callee),
        arguments: newExpr.arguments.map(optimizeForLoopsNode),
        position: newExpr.position
      };
      return optimizedNew;
    }

    case IR.IRNodeType.AwaitExpression: {
      const awaitExpr = node as IR.IRAwaitExpression;
      const optimizedAwait: IR.IRAwaitExpression = {
        type: IR.IRNodeType.AwaitExpression,
        argument: optimizeForLoopsNode(awaitExpr.argument),
        position: awaitExpr.position
      };
      return optimizedAwait;
    }

    case IR.IRNodeType.ThrowStatement: {
      const throwStmt = node as IR.IRThrowStatement;
      const optimizedThrow: IR.IRThrowStatement = {
        type: IR.IRNodeType.ThrowStatement,
        argument: optimizeForLoopsNode(throwStmt.argument),
        position: throwStmt.position
      };
      return optimizedThrow;
    }

    case IR.IRNodeType.ClassDeclaration: {
      const classDecl = node as IR.IRClassDeclaration;
      const optimizedClass: IR.IRClassDeclaration = {
        type: IR.IRNodeType.ClassDeclaration,
        id: classDecl.id,
        fields: classDecl.fields.map(f => optimizeForLoopsNode(f)) as IR.IRClassField[],
        constructor: classDecl.constructor ? optimizeForLoopsNode(classDecl.constructor) as IR.IRClassConstructor : null,
        methods: classDecl.methods.map(m => optimizeForLoopsNode(m)) as IR.IRClassMethod[],
        position: classDecl.position
      };
      return optimizedClass;
    }

    case IR.IRNodeType.ClassMethod: {
      const method = node as IR.IRClassMethod;
      const optimizedMethod: IR.IRClassMethod = {
        type: IR.IRNodeType.ClassMethod,
        name: method.name,
        params: method.params,
        defaults: method.defaults,
        body: optimizeForLoopsNode(method.body) as IR.IRBlockStatement,
        hasJsonParams: method.hasJsonParams,
        position: method.position
      };
      return optimizedMethod;
    }

    case IR.IRNodeType.ClassField: {
      const field = node as IR.IRClassField;
      const optimizedField: IR.IRClassField = {
        type: IR.IRNodeType.ClassField,
        name: field.name,
        mutable: field.mutable,
        initialValue: field.initialValue ? optimizeForLoopsNode(field.initialValue) : null,
        position: field.position
      };
      return optimizedField;
    }

    case IR.IRNodeType.ClassConstructor: {
      const ctor = node as IR.IRClassConstructor;
      const optimizedCtor: IR.IRClassConstructor = {
        type: IR.IRNodeType.ClassConstructor,
        params: ctor.params,
        body: optimizeForLoopsNode(ctor.body) as IR.IRBlockStatement,
        position: ctor.position
      };
      return optimizedCtor;
    }

    case IR.IRNodeType.EnumDeclaration: {
      const enumDecl = node as IR.IREnumDeclaration;
      const optimizedEnum: IR.IREnumDeclaration = {
        type: IR.IRNodeType.EnumDeclaration,
        id: enumDecl.id,
        cases: enumDecl.cases.map(c => optimizeForLoopsNode(c)) as IR.IREnumCase[],
        position: enumDecl.position
      };
      return optimizedEnum;
    }

    case IR.IRNodeType.EnumCase: {
      const enumCase = node as IR.IREnumCase;
      const optimizedCase: IR.IREnumCase = {
        type: IR.IRNodeType.EnumCase,
        id: enumCase.id,
        rawValue: enumCase.rawValue ? optimizeForLoopsNode(enumCase.rawValue) : null,
        associatedValues: enumCase.associatedValues,
        hasAssociatedValues: enumCase.hasAssociatedValues,
        position: enumCase.position
      };
      return optimizedCase;
    }

    case IR.IRNodeType.JsMethodAccess: {
      const jsMethod = node as IR.IRJsMethodAccess;
      const optimizedJsMethod: IR.IRJsMethodAccess = {
        type: IR.IRNodeType.JsMethodAccess,
        object: optimizeForLoopsNode(jsMethod.object),
        method: jsMethod.method,
        position: jsMethod.position
      };
      return optimizedJsMethod;
    }

    default:
      return node;
  }
}

/**
 * Wrap a ForStatement in an IIFE for use in expression positions.
 *
 * Since for statements cannot appear in expression contexts, we wrap them in an IIFE:
 *   for (let i = 0; i < n; i++) { body; }
 * becomes:
 *   (() => { for (let i = 0; i < n; i++) { body; }; return null; })()
 *
 * This preserves the semantics: HQL for loops return null.
 */
function wrapForStatementInIIFE(forStmt: IR.IRForStatement, position?: IR.SourcePosition): IR.IRCallExpression {
  // Create: return null;
  const returnNull: IR.IRReturnStatement = {
    type: IR.IRNodeType.ReturnStatement,
    argument: {
      type: IR.IRNodeType.NullLiteral,
      value: null,
      position
    } as IR.IRNullLiteral,
    position
  };

  // Create: () => { for(...) {...}; return null; }
  const iife: IR.IRFunctionExpression = {
    type: IR.IRNodeType.FunctionExpression,
    id: null,
    params: [],
    body: {
      type: IR.IRNodeType.BlockStatement,
      body: [forStmt, returnNull],
      position
    },
    position
  };

  // Create: (() => { ... })()
  const iifeCall: IR.IRCallExpression = {
    type: IR.IRNodeType.CallExpression,
    callee: iife,
    arguments: [],
    position
  };

  return iifeCall;
}

/**
 * Unwrap a function body for use in a for loop by converting return statements to expression statements.
 *
 * Function bodies typically have return statements like:
 *   function(i) { return result.push(i); }
 *
 * When converting to a for loop, we need to remove the return:
 *   for(let i=0; i<n; i++) { result.push(i); }
 */
function unwrapFunctionBody(body: IR.IRBlockStatement): IR.IRBlockStatement {
  return {
    type: IR.IRNodeType.BlockStatement,
    body: body.body.map(stmt => {
      if (stmt.type === IR.IRNodeType.ReturnStatement) {
        const ret = stmt as IR.IRReturnStatement;
        if (ret.argument) {
          return {
            type: IR.IRNodeType.ExpressionStatement,
            expression: ret.argument,
            position: ret.position
          } as IR.IRExpressionStatement;
        }
        // If return has no argument, skip it
        return null;
      }
      return stmt;
    }).filter((stmt): stmt is IR.IRNode => stmt !== null),
    position: body.position
  };
}

/**
 * Try to optimize a __hql_for_each call to a native for loop.
 *
 * Pattern:
 *   __hql_for_each(sequence, function(varName) { body })
 *
 * Where sequence can be:
 *   - __hql_toSequence(__hql_range(n))          → for(let i=0; i<n; i++)
 *   - __hql_toSequence(__hql_range(start, end)) → for(let i=start; i<end; i++)
 *   - __hql_toSequence(__hql_range(start, end, step)) → for(let i=start; i<end; i+=step)
 */
function tryOptimizeForEachCall(call: IR.IRCallExpression): IR.IRForStatement | null {
  // Must be call to __hql_for_each
  if (call.callee.type !== IR.IRNodeType.Identifier) {
    return null;
  }

  const callee = call.callee as IR.IRIdentifier;
  if (callee.name !== "__hql_for_each") {
    return null;
  }

  // Must have 2 arguments: sequence and iteratee
  if (call.arguments.length !== 2) {
    return null;
  }

  const sequenceArg = call.arguments[0];
  const iterateeArg = call.arguments[1];

  // Iteratee must be a function
  if (iterateeArg.type !== IR.IRNodeType.FunctionExpression) {
    return null;
  }

  const iteratee = iterateeArg as IR.IRFunctionExpression;

  // Function must have exactly 1 parameter (the loop variable)
  if (iteratee.params.length !== 1) {
    return null;
  }

  const loopVar = iteratee.params[0];

  // Try to extract range parameters from sequence
  const rangeInfo = extractRangeInfo(sequenceArg);
  if (!rangeInfo) {
    return null;
  }

  // Unwrap the iteratee function body (remove return statements)
  const loopBody = unwrapFunctionBody(iteratee.body);

  // Build for loop: for(let loopVar = start; loopVar < end; loopVar += step)
  const init: IR.IRVariableDeclaration = {
    type: IR.IRNodeType.VariableDeclaration,
    declarations: [{
      type: IR.IRNodeType.VariableDeclarator,
      id: loopVar,
      init: rangeInfo.start,
      position: call.position
    }],
    kind: "let",
    position: call.position
  };

  const test: IR.IRBinaryExpression = {
    type: IR.IRNodeType.BinaryExpression,
    operator: rangeInfo.step && isNegativeStep(rangeInfo.step) ? ">" : "<",
    left: loopVar,
    right: rangeInfo.end,
    position: call.position
  };

  let update: IR.IRNode;
  if (rangeInfo.step) {
    // i += step
    update = {
      type: IR.IRNodeType.AssignmentExpression,
      operator: "+=",
      left: loopVar,
      right: rangeInfo.step,
      position: call.position
    } as IR.IRAssignmentExpression;
  } else {
    // i++
    update = {
      type: IR.IRNodeType.UnaryExpression,
      operator: "++",
      argument: loopVar,
      prefix: false,
      position: call.position
    } as IR.IRUnaryExpression;
  }

  return {
    type: IR.IRNodeType.ForStatement,
    init,
    test,
    update,
    body: loopBody,
    position: call.position
  };
}

/**
 * Extract range information from sequence argument.
 *
 * Patterns:
 *   __hql_toSequence(__hql_range(n))          → {start: 0, end: n, step: null}
 *   __hql_toSequence(__hql_range(start, end)) → {start, end, step: null}
 *   __hql_toSequence(__hql_range(start, end, step)) → {start, end, step}
 *   __hql_getNumeric(__hql_toSequence, n)     → {start: 0, end: n, step: null}
 */
function extractRangeInfo(sequenceArg: IR.IRNode): {start: IR.IRNode, end: IR.IRNode, step: IR.IRNode | null} | null {
  // Pattern 1: __hql_toSequence(__hql_range(...))
  if (sequenceArg.type === IR.IRNodeType.CallExpression) {
    const call = sequenceArg as IR.IRCallExpression;

    // Check for __hql_toSequence
    if (call.callee.type === IR.IRNodeType.Identifier &&
        (call.callee as IR.IRIdentifier).name === "__hql_toSequence" &&
        call.arguments.length === 1) {

      const innerArg = call.arguments[0];
      if (innerArg.type === IR.IRNodeType.CallExpression) {
        const innerCall = innerArg as IR.IRCallExpression;

        // Check for __hql_range
        if (innerCall.callee.type === IR.IRNodeType.Identifier &&
            (innerCall.callee as IR.IRIdentifier).name === "__hql_range") {

          const rangeArgs = innerCall.arguments;
          if (rangeArgs.length === 1) {
            // __hql_range(n) → for(i=0; i<n; i++)
            return {
              start: {type: IR.IRNodeType.NumericLiteral, value: 0} as IR.IRNumericLiteral,
              end: rangeArgs[0],
              step: null
            };
          } else if (rangeArgs.length === 2) {
            // __hql_range(start, end) → for(i=start; i<end; i++)
            return {
              start: rangeArgs[0],
              end: rangeArgs[1],
              step: null
            };
          } else if (rangeArgs.length === 3) {
            // __hql_range(start, end, step) → for(i=start; i<end; i+=step)
            return {
              start: rangeArgs[0],
              end: rangeArgs[1],
              step: rangeArgs[2]
            };
          }
        }
      }
    }

    // Pattern 2: __hql_getNumeric(__hql_toSequence, n)
    if (call.callee.type === IR.IRNodeType.Identifier &&
        (call.callee as IR.IRIdentifier).name === "__hql_getNumeric" &&
        call.arguments.length === 2) {

      // Second argument is the range end
      return {
        start: {type: IR.IRNodeType.NumericLiteral, value: 0} as IR.IRNumericLiteral,
        end: call.arguments[1],
        step: null
      };
    }
  }

  return null;
}

/**
 * Check if a step expression is negative (for reverse iteration)
 */
function isNegativeStep(step: IR.IRNode): boolean {
  if (step.type === IR.IRNodeType.NumericLiteral) {
    return (step as IR.IRNumericLiteral).value < 0;
  }
  if (step.type === IR.IRNodeType.UnaryExpression) {
    const unary = step as IR.IRUnaryExpression;
    return unary.operator === "-";
  }
  return false;
}
