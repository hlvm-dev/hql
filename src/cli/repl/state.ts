/**
 * HQL REPL State Management
 * Tracks bindings, history, and line numbers
 */

export class ReplState {
  private bindings = new Set<string>();
  private signatures = new Map<string, string[]>();  // function name -> param names
  private _history: string[] = [];
  private _lineNumber = 0;
  private importedModules = new Set<string>();
  private _isLoadingMemory = false;

  /** Add a binding name */
  addBinding(name: string): void {
    this.bindings.add(name);
    (globalThis as Record<string, unknown>)[name] = (globalThis as Record<string, unknown>)[name];
  }

  /** Add a function with its parameter names */
  addFunction(name: string, params: string[]): void {
    this.bindings.add(name);
    this.signatures.set(name, params);
    (globalThis as Record<string, unknown>)[name] = (globalThis as Record<string, unknown>)[name];
  }

  /** Get function signature (param names) */
  getSignature(name: string): string[] | undefined {
    return this.signatures.get(name);
  }

  /** Get all signatures */
  getSignatures(): Map<string, string[]> {
    return this.signatures;
  }

  /** Check if a name is bound */
  hasBinding(name: string): boolean {
    return this.bindings.has(name);
  }

  /** Get all binding names */
  getBindings(): string[] {
    return Array.from(this.bindings);
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
    for (const name of this.bindings) {
      delete (globalThis as Record<string, unknown>)[name];
    }
    this.bindings.clear();
    this.signatures.clear();
    this.importedModules.clear();
    this._lineNumber = 0;
    // Keep history
  }
}
