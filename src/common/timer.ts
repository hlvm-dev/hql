import type { Logger } from "../logger.ts";

/**
 * Timer helper to measure and log transformation phases.
 */
export class Timer {
  private start = performance.now();
  private last = this.start;
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  phase(name: string) {
    const now = performance.now();
    const elapsed = now - this.last;
    this.last = now;
    this.logger.debug(`${name} completed in ${elapsed.toFixed(2)}ms`);
  }

  breakdown(label = "Total transformation") {
    const total = performance.now() - this.start;
    this.logger.debug(`${label} completed in ${total.toFixed(2)}ms`);
  }
}
