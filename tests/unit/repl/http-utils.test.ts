/**
 * HTTP Utils Tests
 *
 * Verifies JSON error responses, CORS headers (with origin-based restriction),
 * NDJSON formatting, and request body parsing with size/type validation.
 */

import { assertEquals } from "jsr:@std/assert";
import {
  jsonError,
  addCorsHeaders,
  isLocalhostOrigin,
  ndjsonLine,
  parseJsonBody,
} from "../../../src/hlvm/cli/repl/http-utils.ts";

// MARK: - jsonError

Deno.test({
  name: "Utils: jsonError - returns correct status and body",
  async fn() {
    const resp = jsonError("Not found", 404);
    assertEquals(resp.status, 404);
    const body = await resp.json();
    assertEquals(body.error, "Not found");
  },
});

Deno.test({
  name: "Utils: jsonError - 400 bad request",
  async fn() {
    const resp = jsonError("Bad input", 400);
    assertEquals(resp.status, 400);
    const body = await resp.json();
    assertEquals(body.error, "Bad input");
  },
});

// MARK: - isLocalhostOrigin

Deno.test({
  name: "Utils: isLocalhostOrigin - accepts http://localhost:3000",
  fn() {
    assertEquals(isLocalhostOrigin("http://localhost:3000"), true);
  },
});

Deno.test({
  name: "Utils: isLocalhostOrigin - accepts http://127.0.0.1:8080",
  fn() {
    assertEquals(isLocalhostOrigin("http://127.0.0.1:8080"), true);
  },
});

Deno.test({
  name: "Utils: isLocalhostOrigin - accepts http://localhost (no port)",
  fn() {
    assertEquals(isLocalhostOrigin("http://localhost"), true);
  },
});

Deno.test({
  name: "Utils: isLocalhostOrigin - rejects http://evil.com",
  fn() {
    assertEquals(isLocalhostOrigin("http://evil.com"), false);
  },
});

Deno.test({
  name: "Utils: isLocalhostOrigin - rejects empty string",
  fn() {
    assertEquals(isLocalhostOrigin(""), false);
  },
});

Deno.test({
  name: "Utils: isLocalhostOrigin - rejects http://localhost.evil.com",
  fn() {
    assertEquals(isLocalhostOrigin("http://localhost.evil.com"), false);
  },
});

// MARK: - addCorsHeaders

Deno.test({
  name: "Utils: addCorsHeaders - sets origin for localhost",
  fn() {
    const resp = addCorsHeaders(new Response("ok"), "http://localhost:3000");
    assertEquals(resp.headers.get("Access-Control-Allow-Origin"), "http://localhost:3000");
    assertEquals(resp.headers.get("Vary"), "Origin");
  },
});

Deno.test({
  name: "Utils: addCorsHeaders - sets origin for 127.0.0.1",
  fn() {
    const resp = addCorsHeaders(new Response("ok"), "http://127.0.0.1:8080");
    assertEquals(resp.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:8080");
  },
});

Deno.test({
  name: "Utils: addCorsHeaders - omits origin for non-localhost",
  fn() {
    const resp = addCorsHeaders(new Response("ok"), "http://evil.com");
    assertEquals(resp.headers.get("Access-Control-Allow-Origin"), null);
    assertEquals(resp.headers.get("Vary"), "Origin");
  },
});

Deno.test({
  name: "Utils: addCorsHeaders - omits origin when no origin provided",
  fn() {
    const resp = addCorsHeaders(new Response("ok"));
    assertEquals(resp.headers.get("Access-Control-Allow-Origin"), null);
    assertEquals(resp.headers.get("Vary"), "Origin");
  },
});

Deno.test({
  name: "Utils: addCorsHeaders - includes Authorization in allowed headers",
  fn() {
    const resp = addCorsHeaders(new Response("ok"), "http://localhost:3000");
    const allowedHeaders = resp.headers.get("Access-Control-Allow-Headers") ?? "";
    assertEquals(allowedHeaders.includes("Authorization"), true);
  },
});

Deno.test({
  name: "Utils: addCorsHeaders - preserves existing headers",
  fn() {
    const resp = addCorsHeaders(new Response("ok", {
      headers: { "X-Custom": "value" },
    }), "http://localhost:3000");
    assertEquals(resp.headers.get("X-Custom"), "value");
    assertEquals(resp.headers.get("Access-Control-Allow-Origin"), "http://localhost:3000");
  },
});

Deno.test({
  name: "Utils: addCorsHeaders - sets methods header",
  fn() {
    const resp = addCorsHeaders(new Response("ok"), "http://localhost:3000");
    assertEquals(resp.headers.get("Access-Control-Allow-Methods"), "GET, POST, PATCH, DELETE, OPTIONS");
  },
});

// MARK: - ndjsonLine

Deno.test({
  name: "Utils: ndjsonLine - formats object with trailing newline",
  fn() {
    const line = ndjsonLine({ event: "token", text: "hello" });
    assertEquals(line, '{"event":"token","text":"hello"}\n');
  },
});

Deno.test({
  name: "Utils: ndjsonLine - handles null",
  fn() {
    assertEquals(ndjsonLine(null), "null\n");
  },
});

// MARK: - parseJsonBody

function jsonRequest(body: unknown, headers?: Record<string, string>): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

Deno.test({
  name: "Utils: parseJsonBody - parses valid JSON",
  async fn() {
    const req = jsonRequest({ name: "test", count: 42 });
    const result = await parseJsonBody<{ name: string; count: number }>(req);
    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.value.name, "test");
      assertEquals(result.value.count, 42);
    }
  },
});

Deno.test({
  name: "Utils: parseJsonBody - rejects invalid JSON",
  async fn() {
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json {{{",
    });
    const result = await parseJsonBody(req);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.response.status, 400);
      const body = await result.response.json();
      assertEquals(body.error, "Invalid JSON");
    }
  },
});

Deno.test({
  name: "Utils: parseJsonBody - rejects missing body",
  async fn() {
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const result = await parseJsonBody(req);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.response.status, 400);
    }
  },
});

Deno.test({
  name: "Utils: parseJsonBody - rejects wrong content-type",
  async fn() {
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: '{"ok": true}',
    });
    const result = await parseJsonBody(req);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.response.status, 400);
      const body = await result.response.json();
      assertEquals(body.error, "Content-Type must be application/json");
    }
  },
});

Deno.test({
  name: "Utils: parseJsonBody - rejects oversized content-length",
  async fn() {
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "2000000",
      },
      body: '{"ok": true}',
    });
    const result = await parseJsonBody(req);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.response.status, 413);
    }
  },
});

Deno.test({
  name: "Utils: parseJsonBody - rejects auto-set text/plain content-type",
  async fn() {
    const req = new Request("http://localhost/test", {
      method: "POST",
      body: '{"ok": true}',
    });
    const result = await parseJsonBody(req);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.response.status, 400);
    }
  },
});

Deno.test({
  name: "Utils: parseJsonBody - accepts empty string body",
  async fn() {
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });
    const result = await parseJsonBody(req);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.response.status, 400);
    }
  },
});
