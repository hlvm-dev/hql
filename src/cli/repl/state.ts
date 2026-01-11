/**
 * HQL REPL State Management
 * Tracks bindings, history, and line numbers
 */

import { getGlobalRecord } from "./string-utils.ts";

// Pre-compiled regex patterns (avoid compilation per-call)
/** Matches function parameter declarations in all JS function forms */
const JS_FUNCTION_PARAMS_REGEX = /^(?:async\s+)?(?:function\s*\*?\s*\w*\s*)?\(([^)]*)\)|^(\w+)\s*=>/;

/**
 * Extract parameter names from a JavaScript function.
 * Uses Function.toString() and regex parsing.
 *
 * Works with:
 * - Regular functions: function foo(a, b, c) {}
 * - Arrow functions: (a, b, c) => {} or a => {}
 * - Async functions: async function foo(a, b) {}
 * - Methods: { foo(a, b) {} }
 *
 * @param fn - The function to extract parameters from
 * @returns Array of parameter names (without defaults, destructuring simplified)
 */
function extractJsFunctionParams(fn: (...args: unknown[]) => unknown): string[] {
  const fnStr = fn.toString();

  // Match function parameters between first ( and )
  // Handles ALL function forms:
  // - function foo(params)
  // - function* foo(params)        <- generator
  // - async function foo(params)
  // - async function* foo(params)  <- async generator (like AI's `ask`)
  // - (params) => ...
  // - x => ...
  // Uses pre-compiled module-level regex for performance
  const match = fnStr.match(JS_FUNCTION_PARAMS_REGEX);

  if (!match) return [];

  // Get the params string (either from parens or single arrow param)
  const paramsStr = match[1] ?? match[2];
  if (!paramsStr || !paramsStr.trim()) return [];

  // If single arrow param (no parens)
  if (match[2]) {
    return [match[2].trim()];
  }

  // Parse comma-separated params, handling defaults and destructuring
  const params: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of paramsStr) {
    if (char === "{" || char === "[" || char === "(") depth++;
    else if (char === "}" || char === "]" || char === ")") depth--;
    else if (char === "," && depth === 0) {
      const param = extractParamName(current.trim());
      if (param) params.push(param);
      current = "";
      continue;
    }
    current += char;
  }

  // Don't forget the last param
  const lastParam = extractParamName(current.trim());
  if (lastParam) params.push(lastParam);

  return params;
}

/**
 * Extract just the parameter name from a param string.
 * Handles: "x", "x = 5", "{ a, b }", "[a, b]", "...rest"
 */
function extractParamName(paramStr: string): string | null {
  if (!paramStr) return null;

  // Rest parameter: ...rest -> rest
  if (paramStr.startsWith("...")) {
    return paramStr.slice(3).split("=")[0].trim();
  }

  // Destructuring: { a, b } -> "opts" (generic name)
  if (paramStr.startsWith("{")) return "opts";

  // Array destructuring: [a, b] -> "arr" (generic name)
  if (paramStr.startsWith("[")) return "arr";

  // Default value: x = 5 -> x
  const name = paramStr.split("=")[0].trim();

  // Type annotation (TypeScript): x: string -> x
  return name.split(":")[0].trim();
}

export class ReplState {
  private bindings = new Set<string>();
  private signatures = new Map<string, string[]>();  // function name -> param names
  private docstrings = new Map<string, string>();    // name -> docstring from comments
  private _history: string[] = [];
  private _lineNumber = 0;
  private importedModules = new Set<string>();
  private _isLoadingMemory = false;

  /** Add a binding name */
  addBinding(name: string): void {
    this.bindings.add(name);
    const g = getGlobalRecord();
    g[name] = g[name];
  }

  /** Add a function with its parameter names */
  addFunction(name: string, params: string[]): void {
    this.bindings.add(name);
    this.signatures.set(name, params);
    const g = getGlobalRecord();
    g[name] = g[name];
  }

  /**
   * Add a JavaScript function and automatically extract its parameter names.
   * Works for any JS function - extracts params via Function.toString() parsing.
   */
  addJsFunction(name: string, fn: (...args: unknown[]) => unknown): void {
    this.bindings.add(name);
    const params = extractJsFunctionParams(fn);
    if (params.length > 0) {
      this.signatures.set(name, params);
    }
    getGlobalRecord()[name] = fn;
  }

  /** Get function signature (param names) */
  getSignature(name: string): string[] | undefined {
    return this.signatures.get(name);
  }

  /** Get all signatures */
  getSignatures(): Map<string, string[]> {
    return this.signatures;
  }

  /** Add a docstring for a name (from comment) */
  addDocstring(name: string, doc: string): void {
    // Create new Map reference so React detects prop change
    this.docstrings = new Map(this.docstrings);
    this.docstrings.set(name, doc);
  }

  /** Add multiple docstrings at once */
  addDocstrings(docs: Map<string, string>): void {
    // Create new Map reference so React detects prop change
    this.docstrings = new Map(this.docstrings);
    for (const [name, doc] of docs) {
      this.docstrings.set(name, doc);
    }
  }

  /** Get docstring for a name */
  getDocstring(name: string): string | undefined {
    return this.docstrings.get(name);
  }

  /** Get all docstrings */
  getDocstrings(): ReadonlyMap<string, string> {
    return this.docstrings;
  }

  /** Check if a name is bound */
  hasBinding(name: string): boolean {
    return this.bindings.has(name);
  }

  /** Get all binding names as array */
  getBindings(): string[] {
    return Array.from(this.bindings);
  }

  /** Get bindings Set directly (for stable reference - avoids allocation) */
  getBindingsSet(): ReadonlySet<string> {
    return this.bindings;
  }

  /** Get command history */
  get history(): string[] {
    return this._history;
  }

  /** Add to history */
  addHistory(input: string): void {
    const trimmed = input.trim();
    if (trimmed && this._history[this._history.length - 1] !== trimmed) {
      this._history.push(trimmed);
    }
  }

  /** Get current line number */
  getLineNumber(): number {
    return this._lineNumber;
  }

  /** Increment and return line number */
  nextLine(): number {
    return ++this._lineNumber;
  }

  /** Check if module has been imported */
  hasImported(path: string): boolean {
    return this.importedModules.has(path);
  }

  /** Mark module as imported */
  markImported(path: string): void {
    this.importedModules.add(path);
  }

  /** Check if currently loading from memory.hql */
  get isLoadingMemory(): boolean {
    return this._isLoadingMemory;
  }

  /** Set loading memory flag (prevents re-persisting loaded definitions) */
  setLoadingMemory(loading: boolean): void {
    this._isLoadingMemory = loading;
  }

  /** Reset REPL state */
  reset(): void {
    // Clear globalThis bindings
    const g = getGlobalRecord();
    for (const name of this.bindings) {
      delete g[name];
    }
    this.bindings.clear();
    this.signatures.clear();
    this.docstrings.clear();
    this.importedModules.clear();
    this._lineNumber = 0;
    // Keep history
    // Note: Stdlib signatures will be re-registered on next initialization
  }
}
