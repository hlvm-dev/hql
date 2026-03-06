import { assertEquals } from "jsr:@std/assert";
import { isOllamaAuthErrorMessage } from "../../../src/common/ollama-auth.ts";

Deno.test("isOllamaAuthErrorMessage: detects auth error patterns", () => {
  assertEquals(isOllamaAuthErrorMessage("unauthorized"), true);
  assertEquals(isOllamaAuthErrorMessage("Unauthorized"), true);
  assertEquals(isOllamaAuthErrorMessage("UNAUTHORIZED"), true);

  assertEquals(isOllamaAuthErrorMessage("401"), true);
  assertEquals(isOllamaAuthErrorMessage("HTTP 401"), true);
  assertEquals(isOllamaAuthErrorMessage("401 Unauthorized"), true);
  assertEquals(isOllamaAuthErrorMessage("status 401: access denied"), true);

  assertEquals(isOllamaAuthErrorMessage("auth required"), true);
  assertEquals(isOllamaAuthErrorMessage("authentication failed"), true);

  assertEquals(isOllamaAuthErrorMessage("please sign in"), true);
  assertEquals(isOllamaAuthErrorMessage("signin required"), true);
  assertEquals(isOllamaAuthErrorMessage("sign-in required"), true);

  assertEquals(
    isOllamaAuthErrorMessage("Unauthorized access to cloud model"),
    true,
  );
});

Deno.test("isOllamaAuthErrorMessage: rejects non-auth errors", () => {
  assertEquals(isOllamaAuthErrorMessage("connection refused"), false);
  assertEquals(isOllamaAuthErrorMessage("model not found"), false);
  assertEquals(isOllamaAuthErrorMessage("timeout waiting for response"), false);
  assertEquals(isOllamaAuthErrorMessage("500 Internal Server Error"), false);
  assertEquals(isOllamaAuthErrorMessage("404 not found"), false);
  assertEquals(isOllamaAuthErrorMessage(""), false);
  assertEquals(isOllamaAuthErrorMessage("pull failed: network error"), false);
  assertEquals(isOllamaAuthErrorMessage("ECONNREFUSED"), false);
  assertEquals(isOllamaAuthErrorMessage("model too large for memory"), false);
});
