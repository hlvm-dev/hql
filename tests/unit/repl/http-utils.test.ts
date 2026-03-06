import { assertEquals } from "jsr:@std/assert";
import {
  addCorsHeaders,
  isLocalhostOrigin,
  jsonError,
  ndjsonLine,
  parseJsonBody,
} from "../../../src/hlvm/cli/repl/http-utils.ts";

function jsonRequest(body: unknown, headers?: Record<string, string>): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function assertErrorResponse(
  result: Awaited<ReturnType<typeof parseJsonBody>>,
  status: number,
  message?: string,
): Promise<void> {
  assertEquals(result.ok, false);
  if (result.ok) return;
  assertEquals(result.response.status, status);
  if (message) {
    const body = await result.response.json();
    assertEquals(body.error, message);
  }
}

Deno.test("HttpUtils: jsonError returns the requested error payload", async () => {
  const response = jsonError("Bad input", 400);
  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: "Bad input" });
});

Deno.test("HttpUtils: isLocalhostOrigin only accepts localhost variants", () => {
  assertEquals(isLocalhostOrigin("http://localhost:3000"), true);
  assertEquals(isLocalhostOrigin("http://127.0.0.1:8080"), true);
  assertEquals(isLocalhostOrigin("http://evil.com"), false);
  assertEquals(isLocalhostOrigin("http://localhost.evil.com"), false);
  assertEquals(isLocalhostOrigin(""), false);
});

Deno.test("HttpUtils: addCorsHeaders echoes trusted origins and sets required CORS headers", () => {
  const response = addCorsHeaders(new Response("ok"), "http://localhost:3000");

  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:3000");
  assertEquals(response.headers.get("Vary"), "Origin");
  assertEquals(
    response.headers.get("Access-Control-Allow-Methods"),
    "GET, POST, PATCH, DELETE, OPTIONS",
  );
  assertEquals(
    response.headers.get("Access-Control-Allow-Headers")?.includes("Authorization"),
    true,
  );
});

Deno.test("HttpUtils: addCorsHeaders blocks untrusted origins and preserves existing headers", () => {
  const response = addCorsHeaders(
    new Response("ok", { headers: { "X-Custom": "value" } }),
    "http://evil.com",
  );

  assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals(response.headers.get("Vary"), "Origin");
  assertEquals(response.headers.get("X-Custom"), "value");
});

Deno.test("HttpUtils: ndjsonLine always appends a trailing newline", () => {
  assertEquals(ndjsonLine({ event: "token", text: "hello" }), '{"event":"token","text":"hello"}\n');
  assertEquals(ndjsonLine(null), "null\n");
});

Deno.test("HttpUtils: parseJsonBody parses valid JSON bodies", async () => {
  const result = await parseJsonBody<{ name: string; count: number }>(
    jsonRequest({ name: "test", count: 42 }),
  );

  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.value, { name: "test", count: 42 });
});

Deno.test("HttpUtils: parseJsonBody rejects non-JSON content types", async () => {
  await assertErrorResponse(
    await parseJsonBody(new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: '{"ok":true}',
    })),
    400,
    "Content-Type must be application/json",
  );

  await assertErrorResponse(
    await parseJsonBody(new Request("http://localhost/test", {
      method: "POST",
      body: '{"ok":true}',
    })),
    400,
    "Content-Type must be application/json",
  );
});

Deno.test("HttpUtils: parseJsonBody rejects invalid JSON and missing bodies", async () => {
  await assertErrorResponse(
    await parseJsonBody(new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json {{{",
    })),
    400,
    "Invalid JSON",
  );

  await assertErrorResponse(
    await parseJsonBody(new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })),
    400,
    "Missing body",
  );

  await assertErrorResponse(
    await parseJsonBody(new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    })),
    400,
    "Missing body",
  );
});

Deno.test("HttpUtils: parseJsonBody enforces request size limits", async () => {
  await assertErrorResponse(
    await parseJsonBody(new Request("http://localhost/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "2000000",
      },
      body: '{"ok":true}',
    })),
    413,
    "Request too large",
  );
});
