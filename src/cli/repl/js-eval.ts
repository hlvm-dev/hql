/**
 * JavaScript Evaluation for Polyglot REPL
 *
 * Transforms JavaScript code to persist variables to globalThis,
 * enabling cross-eval and cross-language (HQL ↔ JS) interoperability.
 */

/**
 * Transform JS code for REPL persistence.
 * Variables are assigned to globalThis for cross-eval access.
 *
 * Transformations:
 * - let x = value     →  let x = globalThis.x = value
 * - const y = value   →  const y = globalThis.y = value
 * - function foo() {} →  function foo() {}; globalThis.foo = foo;
 * - class Bar {}      →  class Bar {}; globalThis.Bar = Bar;
 */
export function transformJSForRepl(code: string): string {
  let transformed = code;

  // Transform: let x = value  →  let x = globalThis.x = value
  // Transform: const y = value  →  const y = globalThis.y = value
  // This pattern handles simple declarations like: let x = 10, const name = "hello"
  transformed = transformed.replace(
    /\b(let|const)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/g,
    "$1 $2 = globalThis.$2 ="
  );

  // Transform function declarations to also assign to globalThis
  // function foo() {} → function foo() {}; globalThis.foo = foo;
  const fnMatches = [...transformed.matchAll(/\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g)];
  const fnNames = fnMatches.map((m) => m[1]);

  // Transform class declarations to also assign to globalThis
  // class Bar {} → class Bar {}; globalThis.Bar = Bar;
  const classMatches = [...transformed.matchAll(/\bclass\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g)];
  const classNames = classMatches.map((m) => m[1]);

  // Append globalThis assignments for functions and classes
  const assignments: string[] = [];
  for (const name of fnNames) {
    assignments.push(`globalThis.${name} = ${name}`);
  }
  for (const name of classNames) {
    assignments.push(`globalThis.${name} = ${name}`);
  }

  if (assignments.length > 0) {
    transformed = transformed + "; " + assignments.join("; ") + ";";
  }

  return transformed;
}

/**
 * Evaluate JavaScript code in REPL context.
 * Uses indirect eval for global scope execution.
 */
export function evaluateJS(code: string): unknown {
  const transformed = transformJSForRepl(code);
  // Indirect eval (0, eval) runs in global scope
  // deno-lint-ignore no-eval
  return (0, eval)(transformed);
}

/**
 * Extract variable names from JS code for state tracking.
 * Returns names of declared variables, functions, and classes.
 */
export function extractJSBindings(code: string): string[] {
  const bindings: string[] = [];

  // let/const/var declarations
  const varMatches = code.matchAll(
    /\b(?:let|const|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g
  );
  for (const match of varMatches) {
    bindings.push(match[1]);
  }

  // function declarations
  const fnMatches = code.matchAll(
    /\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g
  );
  for (const match of fnMatches) {
    bindings.push(match[1]);
  }

  // class declarations
  const classMatches = code.matchAll(
    /\bclass\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g
  );
  for (const match of classMatches) {
    bindings.push(match[1]);
  }

  return bindings;
}
