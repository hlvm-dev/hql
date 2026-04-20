import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  APICallError,
  LoadAPIKeyError,
  NoContentGeneratedError,
  NoSuchModelError,
} from "ai";
import {
  AgentStreamError,
  buildEditFileRecovery,
  classifyError,
  describeErrorForDisplay,
  getRecoveryHint,
  renderEditFileRecoveryPrompt,
} from "../../../src/hlvm/agent/error-taxonomy.ts";
import { TimeoutError } from "../../../src/common/timeout-utils.ts";

Deno.test("error taxonomy: aborts and timeouts map to their dedicated classes", async () => {
  const aborted = new Error("aborted");
  aborted.name = "AbortError";

  assertEquals((await classifyError(aborted)).class, "abort");
  assertEquals((await classifyError(aborted)).retryable, false);

  const timeout = await classifyError(new TimeoutError("LLM call", 1000));
  assertEquals(timeout.class, "timeout");
  assertEquals(timeout.retryable, true);
});

Deno.test("error taxonomy: string-based fallback classification covers rate limits, context, transient, and permanent failures", async () => {
  assertEquals((await classifyError(new Error("Rate limit exceeded (429)"))).class, "rate_limit");
  assertEquals((await classifyError(new Error("This model exceeds the maximum context length"))).class, "context_overflow");
  assertEquals((await classifyError(new Error("Provider HTTP 503: unavailable"))).class, "transient");
  assertEquals((await classifyError(new Error("Invalid request payload"))).class, "permanent");
  assertEquals((await classifyError(new TypeError("bad type"))).class, "permanent");
});

Deno.test("error taxonomy: connection-death errors classify as retryable transient", async () => {
  const connectionErrors = [
    "error reading a body from connection",
    "connection was closed before message completed",
    "socket hang up",
    "EPIPE: broken pipe",
    "ECONNABORTED: software caused connection abort",
    "network error",
  ];
  for (const msg of connectionErrors) {
    const result = await classifyError(new Error(msg));
    assertEquals(result.class, "transient", `"${msg}" should be transient`);
    assertEquals(result.retryable, true, `"${msg}" should be retryable`);
  }
});

Deno.test("error taxonomy: AgentStreamError returns the server's classification verbatim and skips the REQUEST_FAILED fallback hint", async () => {
  const serverMessage =
    "Internal HLVM error while handling the request: Cannot read properties of undefined (reading 'type')";
  const serverHint =
    "This looks like an HLVM bug, not a bad command. Retry once; if it persists, keep the exact command and error text.";

  const streamed = new AgentStreamError(
    serverMessage,
    "unknown",
    false,
    serverHint,
  );

  const described = await describeErrorForDisplay(streamed);
  assertEquals(described.class, "unknown");
  assertEquals(described.retryable, false);
  assertEquals(described.message, serverMessage);
  assertEquals(described.hint, serverHint);
});

Deno.test("error taxonomy: AgentStreamError propagates a null hint when the server sent none, without falling back to REQUEST_FAILED", async () => {
  const streamed = new AgentStreamError(
    "Provider rejected the request",
    "permanent",
    false,
    null,
  );

  const described = await describeErrorForDisplay(streamed);
  assertEquals(described.class, "permanent");
  assertEquals(described.retryable, false);
  assertEquals(described.hint, null);
});

Deno.test("error taxonomy: AgentStreamError preserves structured codes embedded in the server message", () => {
  const streamed = new AgentStreamError(
    "[HQL5001] variable foo is not defined",
    "permanent",
    false,
    null,
  );

  assertEquals(streamed.code, 5001);
  assertStringIncludes(streamed.message, "[HQL5001]");
});

Deno.test("error taxonomy: unexpected internal JS exceptions get an honest display message and hint", async () => {
  const displayed = await describeErrorForDisplay(
    new TypeError("Cannot read properties of undefined (reading 'type')"),
  );

  assertEquals(displayed.class, "unknown");
  assertEquals(displayed.retryable, false);
  assertStringIncludes(
    displayed.message,
    "Internal HLVM error while handling the request:",
  );
  assertStringIncludes(
    displayed.message,
    "Cannot read properties of undefined (reading 'type')",
  );
  assertStringIncludes(displayed.hint ?? "", "HLVM bug");
});

Deno.test("error taxonomy: APICallError uses structured status codes before string matching", async () => {
  const rateLimited = await classifyError(new APICallError({
    statusCode: 429,
    message: "Too many requests",
    url: "http://api.test",
    requestBodyValues: {},
    isRetryable: true,
  }));
  const unauthorized = await classifyError(new APICallError({
    statusCode: 401,
    message: "Unauthorized",
    url: "http://api.test",
    requestBodyValues: {},
    isRetryable: false,
  }));
  const contextOverflow = await classifyError(new APICallError({
    statusCode: 400,
    message: "This model's maximum context length is exceeded",
    url: "http://api.test",
    requestBodyValues: {},
    isRetryable: false,
  }));

  assertEquals(rateLimited.class, "rate_limit");
  assertEquals(rateLimited.retryable, true);
  assertEquals(unauthorized.class, "permanent");
  assertEquals(unauthorized.retryable, false);
  assertEquals(contextOverflow.class, "context_overflow");
  assertEquals(contextOverflow.retryable, true);
});

Deno.test("error taxonomy: SDK-specific auth, no-content, and missing-model errors stay stable", async () => {
  assertEquals(
    (await classifyError(new LoadAPIKeyError({ message: "Missing OPENAI_API_KEY" }))).class,
    "permanent",
  );
  assertEquals(
    (await classifyError(new NoContentGeneratedError({ message: "No output generated" }))).class,
    "transient",
  );
  assertEquals(
    (await classifyError(
      new NoSuchModelError({
        message: "Model not found",
        modelId: "missing",
        modelType: "languageModel",
      }),
    )).class,
    "permanent",
  );
});

Deno.test("error taxonomy: recovery hints cover filesystem and command errors", async () => {
  assertStringIncludes(
    getRecoveryHint("ENOENT: No such file or directory: /tmp/missing.txt") ?? "",
    "list_files",
  );
  assertStringIncludes(
    getRecoveryHint("Permission denied: /etc/shadow") ?? "",
    "Permission denied",
  );
  assertStringIncludes(
    getRecoveryHint("bash: foo: command not found") ?? "",
    "alternative command",
  );
});

Deno.test("error taxonomy: recovery hints cover network, auth, schema, and user-denial flows", async () => {
  assertStringIncludes(
    getRecoveryHint("Operation timed out after 30000ms") ?? "",
    "smaller steps",
  );
  assertStringIncludes(
    getRecoveryHint("Provider HTTP 401: Unauthorized") ?? "",
    "API key",
  );
  assertStringIncludes(
    getRecoveryHint("Invalid tool schema for search_code") ?? "",
    "schema",
  );
  assertStringIncludes(
    getRecoveryHint("Action denied by user") ?? "",
    "alternative approach",
  );
  assertEquals(getRecoveryHint("Some completely novel error"), null);
});

Deno.test("error taxonomy: buildEditFileRecovery produces a structured recovery payload for missing edit targets", () => {
  const recovery = buildEditFileRecovery(
    {
      path: "src/app.ts",
      find: "const oldValue = 1;",
    },
    "Pattern not found in file: const oldValue = 1;",
    [
      "export const newValue = 2;",
      "function run() {",
      "  return newValue;",
      "}",
    ].join("\n"),
  );

  assertEquals(recovery?.kind, "edit_file_target_not_found");
  assertEquals(recovery?.path, "src/app.ts");
  assertStringIncludes(recovery?.excerpt ?? "", "newValue");
  assertEquals(recovery?.closestCurrentLine, "export const newValue = 2;");

  const prompt = recovery ? renderEditFileRecoveryPrompt(recovery) : "";
  assertStringIncludes(prompt, "could not find its target");
  assertStringIncludes(prompt, "Closest current line in the file:");
  assertStringIncludes(prompt, "exact line as your next find string");
});

Deno.test("error taxonomy: buildEditFileRecovery ignores unrelated edit errors", () => {
  const recovery = buildEditFileRecovery(
    {
      path: "src/app.ts",
      find: "const oldValue = 1;",
    },
    "Permission denied: src/app.ts",
    "export const newValue = 2;",
  );

  assertEquals(recovery, null);
});
