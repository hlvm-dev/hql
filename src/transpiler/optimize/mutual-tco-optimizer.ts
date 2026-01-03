/**
 * Mutual Tail Call Optimization (TCO) for mutually recursive functions
 *
 * Transforms mutually recursive functions to use trampoline pattern,
 * preventing stack overflow for deep mutual recursion.
 *
 * Example (sync):
 *   (fn is-even [n] (if (=== n 0) true (is-odd (- n 1))))
 *   (fn is-odd [n] (if (=== n 0) false (is-even (- n 1))))
 *
 * Becomes:
 *   function is_even(n) {
 *     if (n === 0) return true;
 *     return () => is_odd(n - 1);  // Return thunk
 *   }
 *   function is_odd(n) {
 *     if (n === 0) return false;
 *     return () => is_even(n - 1);  // Return thunk
 *   }
 *   // Call site: __hql_trampoline(() => is_even(10000))
 *
 * Example (generator):
 *   (fn* gen-a [n] (if (=== n 0) "done" (yield* (gen-b (- n 1)))))
 *   (fn* gen-b [n] (yield* (gen-a n)))
 *
 * Becomes:
 *   function* gen_a(n) {
 *     if (n === 0) return "done";
 *     return { [__hql_gen_thunk_symbol]: true, next: () => gen_b(n - 1) };
 *   }
 *   // Call site: __hql_trampoline_gen(() => gen_a(10000))
 */

import * as IR from "../type/hql_ir.ts";
import { findTailCallsToFunctions } from "./tail-position-analyzer.ts";

// ============================================================================
// Types
// ============================================================================

interface FunctionInfo {
  name: string;
  node: IR.IRFnFunctionDeclaration;
  tailCallsTo: Set<string>;  // Functions this function tail-calls
  isGenerator: boolean;      // Whether this is a generator function
}

export interface MutualRecursionGroup {
  members: Set<string>;      // Function names in this group
  hasGenerators: boolean;    // Whether any member is a generator (needs __hql_trampoline_gen)
}

// ============================================================================
// Call Graph Analysis
// ============================================================================

/**
 * Check if a node is a call to a known function
 */
function isCallTo(node: IR.IRNode, funcNames: Set<string>): string | null {
  if (
    node.type === IR.IRNodeType.CallExpression &&
    (node as IR.IRCallExpression).callee.type === IR.IRNodeType.Identifier
  ) {
    const name = ((node as IR.IRCallExpression).callee as IR.IRIdentifier).name;
    if (funcNames.has(name)) {
      return name;
    }
  }
  return null;
}


/**
 * Find strongly connected components using Tarjan's algorithm
 * Returns groups of functions that are mutually recursive
 */
function findMutualRecursionGroups(
  functions: Map<string, FunctionInfo>
): MutualRecursionGroup[] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const groups: MutualRecursionGroup[] = [];
  let currentIndex = 0;

  function strongConnect(name: string): void {
    index.set(name, currentIndex);
    lowlink.set(name, currentIndex);
    currentIndex++;
    stack.push(name);
    onStack.add(name);

    const info = functions.get(name);
    if (info) {
      for (const successor of info.tailCallsTo) {
        if (!index.has(successor)) {
          // Successor not yet visited
          strongConnect(successor);
          lowlink.set(name, Math.min(lowlink.get(name)!, lowlink.get(successor)!));
        } else if (onStack.has(successor)) {
          // Successor is on stack → part of current SCC
          lowlink.set(name, Math.min(lowlink.get(name)!, index.get(successor)!));
        }
      }
    }

    // If this is a root node, pop the stack to get the SCC
    if (lowlink.get(name) === index.get(name)) {
      const members = new Set<string>();
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        members.add(w);
      } while (w !== name);

      // Include groups with more than one member (mutual recursion)
      // OR single-member groups with self-tail-calls (self-recursive generators)
      if (members.size > 1) {
        // Check if any member is a generator
        let hasGenerators = false;
        for (const memberName of members) {
          const memberInfo = functions.get(memberName);
          if (memberInfo && memberInfo.isGenerator) {
            hasGenerators = true;
            break;
          }
        }
        groups.push({ members, hasGenerators });
      } else if (members.size === 1) {
        // Check if single function has self-tail-call (generator/async self-recursion)
        const singleName = members.values().next().value as string;
        const singleInfo = functions.get(singleName);
        if (singleInfo && singleInfo.tailCallsTo.has(singleName)) {
          groups.push({ members, hasGenerators: singleInfo.isGenerator });
        }
      }
    }
  }

  for (const name of functions.keys()) {
    if (!index.has(name)) {
      strongConnect(name);
    }
  }

  return groups;
}

// ============================================================================
// Transformation
// ============================================================================

/**
 * Create a thunk IR node that wraps a call expression
 */
function createThunk(callExpr: IR.IRNode): IR.IRFunctionExpression {
  return {
    type: IR.IRNodeType.FunctionExpression,
    id: null,
    params: [],
    body: {
      type: IR.IRNodeType.BlockStatement,
      body: [{
        type: IR.IRNodeType.ReturnStatement,
        argument: callExpr
      } as IR.IRReturnStatement]
    } as IR.IRBlockStatement,
    async: false,
    generator: false
  } as IR.IRFunctionExpression;
}

/**
 * Create a generator thunk IR node (tagged object with Symbol)
 * Returns: { [Symbol.for("__hql_gen_thunk")]: true, next: () => callExpr }
 */
function createGenThunk(callExpr: IR.IRNode): IR.IRObjectExpression {
  // Create Symbol.for("__hql_gen_thunk") call expression
  const symbolForCall: IR.IRCallExpression = {
    type: IR.IRNodeType.CallExpression,
    callee: {
      type: IR.IRNodeType.MemberExpression,
      object: {
        type: IR.IRNodeType.Identifier,
        name: "Symbol"
      } as IR.IRIdentifier,
      property: {
        type: IR.IRNodeType.Identifier,
        name: "for"
      } as IR.IRIdentifier,
      computed: false
    } as IR.IRMemberExpression,
    arguments: [{
      type: IR.IRNodeType.StringLiteral,
      value: "__hql_gen_thunk"
    } as IR.IRStringLiteral]
  };

  return {
    type: IR.IRNodeType.ObjectExpression,
    properties: [
      // [Symbol.for("__hql_gen_thunk")]: true
      {
        type: IR.IRNodeType.ObjectProperty,
        key: symbolForCall,
        value: {
          type: IR.IRNodeType.BooleanLiteral,
          value: true
        } as IR.IRBooleanLiteral,
        computed: true
      } as IR.IRObjectProperty,
      // next: () => callExpr
      {
        type: IR.IRNodeType.ObjectProperty,
        key: {
          type: IR.IRNodeType.Identifier,
          name: "next"
        } as IR.IRIdentifier,
        value: createThunk(callExpr),
        computed: false
      } as IR.IRObjectProperty
    ]
  } as IR.IRObjectExpression;
}

/**
 * Transform a sync function's tail calls to return thunks
 */
function transformToThunks(
  node: IR.IRFnFunctionDeclaration,
  groupMembers: Set<string>
): IR.IRFnFunctionDeclaration {
  const funcName = node.id.name;

  function transformNode(n: IR.IRNode): IR.IRNode {
    switch (n.type) {
      case IR.IRNodeType.BlockStatement: {
        const block = n as IR.IRBlockStatement;
        return {
          type: IR.IRNodeType.BlockStatement,
          body: block.body.map(stmt => transformNode(stmt))
        } as IR.IRBlockStatement;
      }

      case IR.IRNodeType.ReturnStatement: {
        const ret = n as IR.IRReturnStatement;
        if (!ret.argument) return n;

        // Check if returning a call to a group member (exclude self for sync)
        const calledFunc = isCallTo(ret.argument, groupMembers);
        if (calledFunc !== null && calledFunc !== funcName) {
          // Transform: return otherFn(args) → return () => otherFn(args)
          return {
            type: IR.IRNodeType.ReturnStatement,
            argument: createThunk(ret.argument)
          } as IR.IRReturnStatement;
        }

        // Check for conditional with tail calls
        if (ret.argument.type === IR.IRNodeType.ConditionalExpression) {
          const cond = ret.argument as IR.IRConditionalExpression;
          return {
            type: IR.IRNodeType.ReturnStatement,
            argument: {
              type: IR.IRNodeType.ConditionalExpression,
              test: cond.test,
              consequent: transformExpr(cond.consequent),
              alternate: transformExpr(cond.alternate)
            } as IR.IRConditionalExpression
          } as IR.IRReturnStatement;
        }

        return n;
      }

      case IR.IRNodeType.IfStatement: {
        const ifStmt = n as IR.IRIfStatement;
        return {
          type: IR.IRNodeType.IfStatement,
          test: ifStmt.test,
          consequent: transformNode(ifStmt.consequent),
          alternate: ifStmt.alternate ? transformNode(ifStmt.alternate) : null
        } as IR.IRIfStatement;
      }

      default:
        return n;
    }
  }

  function transformExpr(n: IR.IRNode): IR.IRNode {
    const calledFunc = isCallTo(n, groupMembers);
    if (calledFunc !== null && calledFunc !== funcName) {
      return createThunk(n);
    }

    if (n.type === IR.IRNodeType.ConditionalExpression) {
      const cond = n as IR.IRConditionalExpression;
      return {
        type: IR.IRNodeType.ConditionalExpression,
        test: cond.test,
        consequent: transformExpr(cond.consequent),
        alternate: transformExpr(cond.alternate)
      } as IR.IRConditionalExpression;
    }

    // Handle SequenceExpression (from do blocks): transform last expression
    if (n.type === IR.IRNodeType.SequenceExpression) {
      const seqExpr = n as IR.IRSequenceExpression;
      if (seqExpr.expressions.length > 0) {
        const newExprs = [...seqExpr.expressions];
        newExprs[newExprs.length - 1] = transformExpr(newExprs[newExprs.length - 1]);
        return {
          type: IR.IRNodeType.SequenceExpression,
          expressions: newExprs
        } as IR.IRSequenceExpression;
      }
    }

    // Handle IIFE: (() => { ... return tailCall(); })()
    // Transform the body to wrap tail calls in thunks
    if (n.type === IR.IRNodeType.CallExpression) {
      const call = n as IR.IRCallExpression;
      if (call.arguments.length === 0 &&
          call.callee.type === IR.IRNodeType.FunctionExpression) {
        const iife = call.callee as IR.IRFunctionExpression;
        if (iife.params.length === 0 && iife.body) {
          // Transform the IIFE body
          const transformedBody = transformNode(iife.body) as IR.IRBlockStatement;
          return {
            type: IR.IRNodeType.CallExpression,
            callee: {
              ...iife,
              body: transformedBody
            } as IR.IRFunctionExpression,
            arguments: []
          } as IR.IRCallExpression;
        }
      }
    }

    return n;
  }

  return {
    ...node,
    body: transformNode(node.body) as IR.IRBlockStatement
  };
}

/**
 * Transform a generator function's yield* tail calls to return tagged thunks
 */
function transformGenToThunks(
  node: IR.IRFnFunctionDeclaration,
  groupMembers: Set<string>
): IR.IRFnFunctionDeclaration {
  const funcName = node.id.name;

  function transformNode(n: IR.IRNode): IR.IRNode {
    switch (n.type) {
      case IR.IRNodeType.BlockStatement: {
        const block = n as IR.IRBlockStatement;
        return {
          type: IR.IRNodeType.BlockStatement,
          body: block.body.map(stmt => transformNode(stmt))
        } as IR.IRBlockStatement;
      }

      case IR.IRNodeType.ReturnStatement: {
        const ret = n as IR.IRReturnStatement;
        if (!ret.argument) return n;

        // Handle return (yield* call()) - extract the yield* and transform
        if (ret.argument.type === IR.IRNodeType.YieldExpression) {
          const yieldExpr = ret.argument as IR.IRYieldExpression;
          if (yieldExpr.delegate && yieldExpr.argument) {
            const calledFunc = isCallTo(yieldExpr.argument, groupMembers);
            if (calledFunc !== null) {
              // Transform: return (yield* fn(args)) → return { [symbol]: true, next: () => fn(args) }
              return {
                type: IR.IRNodeType.ReturnStatement,
                argument: createGenThunk(yieldExpr.argument)
              } as IR.IRReturnStatement;
            }
          }
        }

        // Check for conditional with yield* tail calls
        if (ret.argument.type === IR.IRNodeType.ConditionalExpression) {
          const cond = ret.argument as IR.IRConditionalExpression;
          return {
            type: IR.IRNodeType.ReturnStatement,
            argument: {
              type: IR.IRNodeType.ConditionalExpression,
              test: cond.test,
              consequent: transformExpr(cond.consequent),
              alternate: transformExpr(cond.alternate)
            } as IR.IRConditionalExpression
          } as IR.IRReturnStatement;
        }

        return n;
      }

      case IR.IRNodeType.ExpressionStatement: {
        const expr = (n as IR.IRExpressionStatement).expression;
        // Handle yield* call() as expression statement in tail position
        if (expr.type === IR.IRNodeType.YieldExpression) {
          const yieldExpr = expr as IR.IRYieldExpression;
          if (yieldExpr.delegate && yieldExpr.argument) {
            const calledFunc = isCallTo(yieldExpr.argument, groupMembers);
            if (calledFunc !== null) {
              // Transform: yield* fn(args) → return { [symbol]: true, next: () => fn(args) }
              return {
                type: IR.IRNodeType.ReturnStatement,
                argument: createGenThunk(yieldExpr.argument)
              } as IR.IRReturnStatement;
            }
          }
        }
        return n;
      }

      case IR.IRNodeType.IfStatement: {
        const ifStmt = n as IR.IRIfStatement;
        return {
          type: IR.IRNodeType.IfStatement,
          test: ifStmt.test,
          consequent: transformNode(ifStmt.consequent),
          alternate: ifStmt.alternate ? transformNode(ifStmt.alternate) : null
        } as IR.IRIfStatement;
      }

      default:
        return n;
    }
  }

  function transformExpr(n: IR.IRNode): IR.IRNode {
    // Handle yield* expression
    if (n.type === IR.IRNodeType.YieldExpression) {
      const yieldExpr = n as IR.IRYieldExpression;
      if (yieldExpr.delegate && yieldExpr.argument) {
        const calledFunc = isCallTo(yieldExpr.argument, groupMembers);
        if (calledFunc !== null) {
          return createGenThunk(yieldExpr.argument);
        }
      }
    }

    if (n.type === IR.IRNodeType.ConditionalExpression) {
      const cond = n as IR.IRConditionalExpression;
      return {
        type: IR.IRNodeType.ConditionalExpression,
        test: cond.test,
        consequent: transformExpr(cond.consequent),
        alternate: transformExpr(cond.alternate)
      } as IR.IRConditionalExpression;
    }

    // Handle SequenceExpression (from do blocks): transform last expression
    if (n.type === IR.IRNodeType.SequenceExpression) {
      const seqExpr = n as IR.IRSequenceExpression;
      if (seqExpr.expressions.length > 0) {
        const newExprs = [...seqExpr.expressions];
        newExprs[newExprs.length - 1] = transformExpr(newExprs[newExprs.length - 1]);
        return {
          type: IR.IRNodeType.SequenceExpression,
          expressions: newExprs
        } as IR.IRSequenceExpression;
      }
    }

    // Handle IIFE: (() => { ... return yield* tailCall(); })()
    // Transform the body to wrap tail calls in thunks
    if (n.type === IR.IRNodeType.CallExpression) {
      const call = n as IR.IRCallExpression;
      if (call.arguments.length === 0 &&
          call.callee.type === IR.IRNodeType.FunctionExpression) {
        const iife = call.callee as IR.IRFunctionExpression;
        if (iife.params.length === 0 && iife.body) {
          // Transform the IIFE body
          const transformedBody = transformNode(iife.body) as IR.IRBlockStatement;
          return {
            type: IR.IRNodeType.CallExpression,
            callee: {
              ...iife,
              body: transformedBody
            } as IR.IRFunctionExpression,
            arguments: []
          } as IR.IRCallExpression;
        }
      }
    }

    return n;
  }

  return {
    ...node,
    body: transformNode(node.body) as IR.IRBlockStatement
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Analyze a module for mutual recursion and transform affected functions
 *
 * @param statements - All IR statements in the module
 * @returns Transformed statements with mutual TCO applied
 */
export function applyMutualTCO(
  statements: IR.IRNode[]
): { statements: IR.IRNode[]; mutualGroups: MutualRecursionGroup[] } {
  // Step 1: Collect all named function declarations
  const functions = new Map<string, FunctionInfo>();
  const functionNames = new Set<string>();

  for (const stmt of statements) {
    if (stmt.type === IR.IRNodeType.FnFunctionDeclaration) {
      const fn = stmt as IR.IRFnFunctionDeclaration;
      // Skip async functions - they don't need TCO because await naturally breaks the stack
      // Each await suspends execution and starts fresh, so no stack overflow possible
      if (fn.async) {
        continue;
      }
      const name = fn.id.name;
      functionNames.add(name);
      functions.set(name, {
        name,
        node: fn,
        tailCallsTo: new Set(),
        isGenerator: fn.generator || false
      });
    }
  }

  // Step 2: Build call graph (find tail calls between functions)
  // For generators: include self-calls (they need trampoline TCO since yield* grows stack)
  // For sync: exclude self-calls (handled by while-loop TCO optimizer)
  for (const [name, info] of functions) {
    info.tailCallsTo = findTailCallsToFunctions(info.node.body, name, functionNames, {
      includeSelfCalls: info.isGenerator,
      treatYieldDelegateAsTail: info.isGenerator
    });
  }

  // Step 3: Find mutual recursion groups (SCCs with size > 1, or single with self-tail-call)
  const mutualGroups = findMutualRecursionGroups(functions);

  if (mutualGroups.length === 0) {
    return { statements, mutualGroups: [] };
  }

  // Step 4: Transform functions in mutual recursion groups
  const transformedFunctions = new Map<string, IR.IRFnFunctionDeclaration>();

  for (const group of mutualGroups) {
    for (const funcName of group.members) {
      const info = functions.get(funcName);
      if (info) {
        // Use different transform for generators vs sync functions
        if (info.isGenerator) {
          transformedFunctions.set(funcName, transformGenToThunks(info.node, group.members));
        } else {
          transformedFunctions.set(funcName, transformToThunks(info.node, group.members));
        }
      }
    }
  }

  // Step 5: Replace original functions with transformed ones
  const newStatements = statements.map(stmt => {
    if (stmt.type === IR.IRNodeType.FnFunctionDeclaration) {
      const fn = stmt as IR.IRFnFunctionDeclaration;
      const transformed = transformedFunctions.get(fn.id.name);
      if (transformed) {
        return transformed;
      }
    }
    return stmt;
  });

  return { statements: newStatements, mutualGroups };
}

/**
 * Check if a function is in a mutual recursion group
 */
export function isInMutualRecursionGroup(
  funcName: string,
  groups: MutualRecursionGroup[]
): boolean {
  return groups.some(group => group.members.has(funcName));
}

/**
 * Get the mutual recursion group for a function
 */
export function getMutualRecursionGroup(
  funcName: string,
  groups: MutualRecursionGroup[]
): MutualRecursionGroup | null {
  return groups.find(group => group.members.has(funcName)) || null;
}
