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
export interface HttpOptions {
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
   * Perform a POST request with JSON body
   */
  post<T>(url: string, body: unknown, options?: HttpOptions): Promise<T> {
    return this.bodyRequest<T>("POST", url, body, options);
  }

  /**
   * Perform a PUT request with JSON body
   */
  put<T>(url: string, body: unknown, options?: HttpOptions): Promise<T> {
    return this.bodyRequest<T>("PUT", url, body, options);
  }

  /**
   * Perform a DELETE request
   */
  delete<T>(url: string, options?: HttpOptions): Promise<T> {
    return this.request<T>(url, { method: "DELETE", ...options });
  }

  /**
   * Fetch JSON from a URL (alias for get, kept for backward compatibility)
   */
  fetchJson<T>(url: string, options?: HttpOptions): Promise<T> {
    return this.get<T>(url, options);
  }

  /**
   * Fetch raw response (for non-JSON responses)
   */
  async fetchRaw(
    url: string,
    options?: HttpOptions & RequestInit,
  ): Promise<Response> {
    const timeout = options?.timeout ?? this.defaultTimeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Combine parent signal with timeout signal so both are effective
    const signal = options?.signal
      ? combineSignals(controller.signal, options.signal)
      : controller.signal;

    try {
      return await fetch(url, { ...options, signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Shared implementation for POST/PUT with JSON body (DRY)
   */
  private bodyRequest<T>(
    method: string,
    url: string,
    body: unknown,
    options?: HttpOptions,
  ): Promise<T> {
    const { headers: optHeaders, ...restOptions } = options ?? {};
    return this.request<T>(url, {
      method,
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", ...optHeaders },
      ...restOptions,
    });
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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Combine parent signal with timeout so both are effective
      const signal = options.signal
        ? combineSignals(controller.signal, options.signal)
        : controller.signal;

      try {
        const response = await fetch(url, { ...options, signal });

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
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastError ?? new Error(`Request failed: ${url}`);
  }
}

/**
 * Singleton HTTP client instance
 *
 * Usage:
 * ```typescript
 * import { http } from "../common/http-client.ts";
 *
 * const data = await http.get<MyType>("https://api.example.com/data");
 * await http.post("https://api.example.com/submit", { value: 123 });
 * ```
 */
export const http = new HttpClient();

export default http;
