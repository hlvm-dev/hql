/**
 * HTTP Client - SSOT for all external HTTP calls
 *
 * This module provides a centralized HTTP client with:
 * - Configurable timeout
 * - Optional retry logic
 * - Type-safe responses
 *
 * SSOT: All HTTP calls outside providers should use this module.
 * Providers (e.g., Ollama) have special requirements and are allowed bypasses.
 *
 * @see docs/SSOT-CONTRACT.md for allowed bypasses
 */

import { RuntimeError } from "./error.ts";
import { combineSignals } from "./timeout-utils.ts";
import { ensureError } from "./utils.ts";

/**
 * HTTP request options
 */
interface HttpOptions {
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Additional headers */
  headers?: Record<string, string>;
  /** Number of retries on failure (default: 0) */
  retry?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * HTTP error with response details
 */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly url: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Internal HTTP client implementation
 */
class HttpClient {
  private readonly defaultTimeout = 30000; // 30 seconds

  /**
   * Perform a GET request
   */
  get<T>(url: string, options?: HttpOptions): Promise<T> {
    return this.request<T>(url, { method: "GET", ...options });
  }

  /**
   * Fetch raw response (for non-JSON responses)
   */
  async fetchRaw(
    url: string,
    options?: HttpOptions & RequestInit,
  ): Promise<Response> {
    return this.withTimeoutSignal(options, (signal) =>
      fetch(url, { ...options, signal }),
    );
  }

  /**
   * Internal request implementation with timeout and retry
   */
  private async request<T>(
    url: string,
    options: RequestInit & HttpOptions,
  ): Promise<T> {
    const timeout = options.timeout ?? this.defaultTimeout;
    const retries = options.retry ?? 0;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.withTimeoutSignal(options, (signal) =>
          fetch(url, { ...options, signal }),
        );

        if (!response.ok) {
          throw new HttpError(
            `HTTP ${response.status}: ${response.statusText}`,
            response.status,
            response.statusText,
            url,
          );
        }

        return await response.json() as T;
      } catch (error) {
        lastError = ensureError(error);

        // Don't retry on abort or client errors (4xx)
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new RuntimeError(`Request timeout after ${timeout}ms: ${url}`);
        }
        if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
          throw error;
        }

        // Retry on server errors (5xx) or network errors
        if (attempt < retries) {
          // Exponential backoff: 100ms, 200ms, 400ms...
          await new Promise((r) => setTimeout(r, 100 * Math.pow(2, attempt)));
          continue;
        }
      }
    }

    throw lastError ?? new Error(`Request failed: ${url}`);
  }

  /**
   * Execute an async operation with a combined timeout + parent signal.
   * Consolidates the repeated timeout-controller + combineSignals + clearTimeout pattern.
   */
  private async withTimeoutSignal<T>(
    options: HttpOptions | undefined,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const timeout = options?.timeout ?? this.defaultTimeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const signal = options?.signal
      ? combineSignals(controller.signal, options.signal)
      : controller.signal;

    try {
      return await fn(signal);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/** Singleton HTTP client instance */
export const http = new HttpClient();

export default http;
