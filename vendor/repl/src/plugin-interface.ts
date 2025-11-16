/**
 * Public interfaces for the Pure REPL plugin system.
 * Plugins wrap full transpilers/runtimes and the REPL core
 * only handles user interaction plus persistent module state.
 */

/** Result returned from plugin evaluation. */
export interface EvalResult {
  /** Value to display in the REPL. */
  value?: unknown;
  /** Custom formatted string to print instead of auto-formatting value. */
  formatted?: string;
  /** Optional number of logical lines consumed (default: 1). */
  lines?: number;
  /** Optional flag to skip default printer. */
  suppressOutput?: boolean;
}

/** Runtime context shared with plugins during detection/evaluation. */
export interface REPLContext {
  /** Absolute path to the module file that holds the persistent session. */
  readonly modulePath: string;
  /** Temporary directory that contains the module file. */
  readonly tempDir: string;
  /** Current REPL logical line number (auto-incremented after each eval). */
  readonly lineNumber: number;
  /**
   * Append JavaScript to the persistent module file.
   * Plugins typically transpile code and call this helper.
   */
  appendToModule(code: string): Promise<void>;
  /** Replace the entire module file contents. */
  overwriteModule(code: string): Promise<void>;
  /**
   * Re-import the persistent module, busting Deno's module cache.
   * Returns the module namespace object so plugins can read exports.
   */
  reimportModule<T = Record<string, unknown>>(): Promise<T>;
  /** Reset plugin-specific state stored with the REPL. */
  resetState(): void;
  /** Retrieve plugin-specific state. */
  getState<T = unknown>(key: string): T | undefined;
  /** Store plugin-specific state. */
  setState(key: string, value: unknown): void;
}

/** Command handler metadata that plugins can register. */
export interface REPLCommand {
  description?: string;
  handler(context: REPLContext): Promise<void> | void;
}

/** Plugin definition used by the Pure REPL core. */
export interface REPLPlugin {
  /** Human-friendly plugin name (displayed in help output). */
  readonly name: string;
  /** Optional description. */
  readonly description?: string;
  /**
   * Return a priority number if this plugin can handle `code`.
   * Higher numbers win. Return `false` to skip. If not implemented,
   * the plugin is treated as the fallback handler.
   */
  detect?(code: string, context: REPLContext): Promise<number | boolean> | number | boolean;
  /** Evaluate code and return a result. */
  evaluate(code: string, context: REPLContext): Promise<EvalResult | void> | EvalResult | void;
  /** Optional initialization hook (called once when REPL starts). */
  init?(context: REPLContext): Promise<void> | void;
  /** Optional cleanup hook (called once during shutdown). */
  cleanup?(context: REPLContext): Promise<void> | void;
  /** Optional plugin-specific commands (e.g., .hql, .ts, etc.). */
  commands?: Record<string, REPLCommand>;
}

/** Optional configuration parameters for the REPL core. */
export interface REPLConfig {
  banner?: string;
  prompt?: string;
  debug?: boolean;
  /** Custom commands shared across all plugins. */
  commands?: Record<string, REPLCommand>;
  /** Hook that runs after the temporary module is created. */
  onInit?(context: REPLContext): Promise<void> | void;
}
