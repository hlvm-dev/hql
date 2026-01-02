/**
 * Mutual Tail Call Optimization (TCO) for mutually recursive functions
 *
 * Transforms mutually recursive functions to use trampoline pattern,
 * preventing stack overflow for deep mutual recursion.
 *
 * Example:
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
 */

import * as IR from "../type/hql_ir.ts";

// ============================================================================
// Types
// ============================================================================

interface FunctionInfo {
  name: string;
  node: IR.IRFnFunctionDeclaration;
  tailCallsTo: Set<string>;  // Functions this function tail-calls
}

export interface MutualRecursionGroup {
  members: Set<string>;  // Function names in this group
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
 * Find all tail calls in a function body to known functions
 */
function findTailCalls(
  body: IR.IRBlockStatement,
  funcName: string,
  knownFunctions: Set<string>
): Set<string> {
  const tailCalls = new Set<string>();

  function checkTailPosition(node: IR.IRNode, inTailPosition: boolean): void {
    switch (node.type) {
      case IR.IRNodeType.BlockStatement: {
        const stmts = (node as IR.IRBlockStatement).body;
        stmts.forEach((stmt, i) => {
          checkTailPosition(stmt, inTailPosition && i === stmts.length - 1);
        });
        break;
      }

      case IR.IRNodeType.ReturnStatement: {
        const arg = (node as IR.IRReturnStatement).argument;
        if (arg) checkExpr(arg, true);
        break;
      }

      case IR.IRNodeType.IfStatement: {
        const ifStmt = node as IR.IRIfStatement;
        checkExpr(ifStmt.test, false);
        checkTailPosition(ifStmt.consequent, inTailPosition);
        if (ifStmt.alternate) checkTailPosition(ifStmt.alternate, inTailPosition);
        break;
      }

      case IR.IRNodeType.ExpressionStatement:
        checkExpr((node as IR.IRExpressionStatement).expression, false);
        break;

      case IR.IRNodeType.VariableDeclaration:
        (node as IR.IRVariableDeclaration).declarations.forEach(d => {
          if (d.init) checkExpr(d.init, false);
        });
        break;
    }
  }

  function checkExpr(node: IR.IRNode, inTailPosition: boolean): void {
    const calledFunc = isCallTo(node, knownFunctions);
    if (calledFunc !== null && calledFunc !== funcName && inTailPosition) {
      // Tail call to a different known function
      tailCalls.add(calledFunc);
    }

    switch (node.type) {
      case IR.IRNodeType.ConditionalExpression: {
        const cond = node as IR.IRConditionalExpression;
        checkExpr(cond.test, false);
        checkExpr(cond.consequent, inTailPosition);
        checkExpr(cond.alternate, inTailPosition);
        break;
      }

      case IR.IRNodeType.BinaryExpression: {
        const bin = node as IR.IRBinaryExpression;
        checkExpr(bin.left, false);
        checkExpr(bin.right, false);
        break;
      }

      case IR.IRNodeType.UnaryExpression:
        checkExpr((node as IR.IRUnaryExpression).argument, false);
        break;

      case IR.IRNodeType.CallExpression: {
        const call = node as IR.IRCallExpression;
        call.arguments.forEach(arg => checkExpr(arg, false));
        break;
      }

      case IR.IRNodeType.ArrayExpression:
        (node as IR.IRArrayExpression).elements.forEach(el => {
          if (el) checkExpr(el, false);
        });
        break;

      case IR.IRNodeType.MemberExpression: {
        const mem = node as IR.IRMemberExpression;
        checkExpr(mem.object, false);
        if (mem.computed) checkExpr(mem.property, false);
        break;
      }
    }
  }

  checkTailPosition(body, true);
  return tailCalls;
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

      // Only include groups with more than one member (mutual recursion)
      if (members.size > 1) {
        groups.push({ members });
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
 * Transform a function's tail calls to return thunks
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

        // Check if returning a call to a group member
        const calledFunc = isCallTo(ret.argument, groupMembers);
        if (calledFunc !== null && calledFunc !== funcName) {
          // Transform: return otherFn(args) → return () => otherFn(args)
          // Use FunctionExpression with empty params to create a thunk
          return {
            type: IR.IRNodeType.ReturnStatement,
            argument: {
              type: IR.IRNodeType.FunctionExpression,
              id: null,
              params: [],
              body: {
                type: IR.IRNodeType.BlockStatement,
                body: [{
                  type: IR.IRNodeType.ReturnStatement,
                  argument: ret.argument
                } as IR.IRReturnStatement]
              } as IR.IRBlockStatement,
              async: false,
              generator: false
            } as IR.IRFunctionExpression
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
      // Wrap in function expression (thunk)
      return {
        type: IR.IRNodeType.FunctionExpression,
        id: null,
        params: [],
        body: {
          type: IR.IRNodeType.BlockStatement,
          body: [{
            type: IR.IRNodeType.ReturnStatement,
            argument: n
          } as IR.IRReturnStatement]
        } as IR.IRBlockStatement,
        async: false,
        generator: false
      } as IR.IRFunctionExpression;
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
      const name = fn.id.name;
      functionNames.add(name);
      functions.set(name, {
        name,
        node: fn,
        tailCallsTo: new Set()
      });
    }
  }

  // Step 2: Build call graph (find tail calls between functions)
  for (const [name, info] of functions) {
    info.tailCallsTo = findTailCalls(info.node.body, name, functionNames);
  }

  // Step 3: Find mutual recursion groups (SCCs with size > 1)
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
        transformedFunctions.set(funcName, transformToThunks(info.node, group.members));
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
