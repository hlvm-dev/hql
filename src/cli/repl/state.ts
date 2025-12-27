/**
 * HQL REPL State Management
 * Tracks bindings, history, and line numbers
 */

export class ReplState {
  private bindings = new Set<string>();
  private _history: string[] = [];
  private _lineNumber = 0;
  private importedModules = new Set<string>();

  /** Add a binding name */
  addBinding(name: string): void {
    this.bindings.add(name);
    (globalThis as Record<string, unknown>)[name] = (globalThis as Record<string, unknown>)[name];
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

  /** Reset REPL state */
  reset(): void {
    // Clear globalThis bindings
    for (const name of this.bindings) {
      delete (globalThis as Record<string, unknown>)[name];
    }
    this.bindings.clear();
    this.importedModules.clear();
    this._lineNumber = 0;
    // Keep history
  }
}
