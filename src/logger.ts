/**
 * Enhanced logger module with improved namespace support and timing
 */
import { getErrorMessage } from "./common/utils.ts";
import { LRUCache } from "./common/lru-cache.ts";

/**
 * Best-effort console write that never throws into request handlers.
 * macOS pipes can surface EAGAIN ("Resource temporarily unavailable")
 * under backpressure; logging should never crash business logic.
 */
function safeWrite(fn: (...args: unknown[]) => void, ...args: unknown[]): void {
  try {
    fn(...args);
  } catch {
    // Intentionally drop log writes on I/O backpressure or closed fds.
  }
}

export interface LogOptions {
  text: string;
  namespace?: string;
}

export interface TimingOptions {
  showTiming?: boolean;
}

class TimingData {
  private timings = new Map<string, number>();
  private timePoints = new Map<string, number>();
  private startTime: number;

  constructor() {
    this.startTime = performance.now();
  }

  start(label: string): void {
    this.timePoints.set(label, performance.now());
  }

  end(label: string): number {
    const startPoint = this.timePoints.get(label);
    if (!startPoint) {
      return 0;
    }

    const duration = performance.now() - startPoint;
    this.timings.set(label, duration);
    return duration;
  }

  getTimings(): Map<string, number> {
    return this.timings;
  }

  getTotalTime(): number {
    return performance.now() - this.startTime;
  }
}

export class Logger {
  /** Static Set for O(1) namespace lookup (vs O(n) array.includes) */
  static allowedNamespacesSet: Set<string> = new Set();
  /** Static array of wildcard patterns (checked separately) */
  static allowedWildcards: string[] = [];

  /** Instance property to control logging when no namespace filtering is applied */
  public enabled: boolean;

  /** Timing data for performance tracking (bounded to prevent memory leaks) */
  private timingData = new LRUCache<string, TimingData>(500);

  /** Whether to show timing information */
  private showTiming: boolean = false;

  /**
   * Create a new logger
   * @param enabled Whether logging is enabled (used when --verbose is set)
   */
  constructor(enabled = false) {
    this.enabled = enabled;
  }

  /**
   * Configure timing options
   */
  setTimingOptions(options: TimingOptions): void {
    this.showTiming = !!options.showTiming;
  }

  /**
   * Start timing an operation for a specific context
   */
  startTiming(context: string, label: string): void {
    if (!this.timingData.has(context)) {
      this.timingData.set(context, new TimingData());
    }

    this.timingData.get(context)!.start(label);
  }

  /**
   * End timing an operation for a specific context
   */
  endTiming(context: string, label: string): number {
    if (!this.timingData.has(context)) {
      return 0;
    }

    const duration = this.timingData.get(context)!.end(label);

    if (this.enabled) {
      const durationInSeconds = (duration / 1000).toFixed(2);
      this.debug(
        `${label} completed in ${
          duration.toFixed(0)
        }ms (${durationInSeconds}s)`,
        "timing",
      );
    }

    return duration;
  }

  /**
   * Log performance metrics for a context if timing is enabled
   */
  logPerformance(context: string, filename?: string): void {
    if (!this.showTiming || !this.timingData.has(context)) return;

    const timingData = this.timingData.get(context)!;
    const timings = timingData.getTimings();
    const total = Array.from(timings.values()).reduce((a, b) => a + b, 0);
    const totalTime = timingData.getTotalTime();

    // Always use console for performance metrics to ensure they're visible
    safeWrite(console.log, `=== 🕒 Performance Metrics: ${context} ===`);
    if (filename) {
      safeWrite(console.log, `${filename}`);
    }

    for (const [label, time] of timings.entries()) {
      // Show time in both ms and seconds
      const timeInSeconds = (time / 1000).toFixed(2);
      safeWrite(
        console.log,
        `  ${label.padEnd(20)} ${time.toFixed(0)}ms (${timeInSeconds}s) ${
          ((time / total) * 100).toFixed(1)
        }%`,
      );
    }

    // Add any unaccounted time
    const unaccounted = totalTime - total;
    if (unaccounted > 1) { // Only show if significant
      const unaccountedInSeconds = (unaccounted / 1000).toFixed(2);
      safeWrite(
        console.log,
        `  Other               ${
          unaccounted.toFixed(0)
        }ms (${unaccountedInSeconds}s) ${
          ((unaccounted / totalTime) * 100).toFixed(1)
        }%`,
      );
    }

    const totalTimeInSeconds = (totalTime / 1000).toFixed(2);
    safeWrite(
      console.log,
      `  ✅ Total               ${
        totalTime.toFixed(0)
      }ms (${totalTimeInSeconds}s)`,
    );
    safeWrite(console.log, "=========================");
  }

  /**
   * Log a message based on namespace filtering or verbose mode
   * @param options Object containing the message text and optional namespace
   */
  log({ text, namespace }: LogOptions): void {
    // If --verbose is enabled, log everything regardless of namespace
    if (this.enabled) {
      safeWrite(console.log, namespace ? `[${namespace}] ${text}` : text);
      return;
    }

    // If --log is provided with namespaces, only log if the namespace matches
    if (this.isNamespaceEnabled(namespace)) {
      safeWrite(console.log, `[${namespace}] ${text}`);
    }
  }

  /**
   * Set allowed namespaces (converts to Set for O(1) lookup)
   */
  static setAllowedNamespaces(namespaces: string[]): void {
    Logger.allowedNamespacesSet.clear();
    Logger.allowedWildcards = [];
    for (const ns of namespaces) {
      if (ns.endsWith("*")) {
        Logger.allowedWildcards.push(ns.slice(0, -1));
      } else {
        Logger.allowedNamespacesSet.add(ns);
      }
    }
  }

  /**
   * Check if a given namespace is enabled for logging
   * O(1) for exact matches, O(w) for wildcards where w is number of wildcards
   */
  isNamespaceEnabled(namespace?: string): boolean {
    if (!namespace) return false;

    // If no allowed namespaces are specified, none are enabled
    if (Logger.allowedNamespacesSet.size === 0 && Logger.allowedWildcards.length === 0) return false;

    // O(1) check for exact namespace match
    if (Logger.allowedNamespacesSet.has(namespace)) return true;

    // O(w) check for wildcard matches (e.g., "macro*" would match "macro-expansion")
    for (const prefix of Logger.allowedWildcards) {
      if (namespace.startsWith(prefix)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Log a debug message if logging is enabled or if namespace is enabled
   */
  debug(message: string, namespace?: string): void {
    if (this.enabled || this.isNamespaceEnabled(namespace)) {
      const prefix = namespace ? `[${namespace}] ` : "";
      safeWrite(console.log, `${prefix}${message}`);
    }
  }

  /**
   * Log an info message if logging is enabled or if namespace is enabled
   */
  info(message: string, namespace?: string): void {
    if (this.enabled || this.isNamespaceEnabled(namespace)) {
      const prefix = namespace ? `[${namespace}] ` : "";
      safeWrite(console.log, `${prefix}${message}`);
    }
  }

  /**
   * Log a warning message (always shown, can include namespace)
   */
  warn(message: string, namespace?: string): void {
    const prefix = namespace ? `[${namespace}] ` : "";
    safeWrite(console.warn, `⚠️ ${prefix}${message}`);
  }

  /**
   * Log an error message (always shown, can include namespace)
   */
  error(message: string, error?: unknown, namespace?: string): void {
    const errorDetails = error ? `: ${getErrorMessage(error)}` : "";
    const prefix = namespace ? `[${namespace}] ` : "";
    safeWrite(console.error, `❌ ${prefix}${message}${errorDetails}`);
  }

  /**
   * Enable or disable logging
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

// Singleton instance for shared logging across modules
const globalLogger = new Logger();
export default globalLogger;
export { globalLogger };
