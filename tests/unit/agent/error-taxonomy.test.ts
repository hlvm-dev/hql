import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  APICallError,
  LoadAPIKeyError,
  NoContentGeneratedError,
  NoSuchModelError,
} from "ai";
import {
  buildEditFileRecovery,
  classifyError,
  getRecoveryHint,
  renderEditFileRecoveryPrompt,
} from "../../../src/hlvm/agent/error-taxonomy.ts";
import { TimeoutError } from "../../../src/common/timeout-utils.ts";

Deno.test("error taxonomy: aborts and timeouts map to their dedicated classes", () => {
  const aborted = new Error("aborted");
  aborted.name = "AbortError";

  assertEquals(classifyError(aborted).class, "abort");
  assertEquals(classifyError(aborted).retryable, false);

  const timeout = classifyError(new TimeoutError("LLM call", 1000));
  assertEquals(timeout.class, "timeout");
  assertEquals(timeout.retryable, true);
});

Deno.test("error taxonomy: string-based fallback classification covers rate limits, context, transient, and permanent failures", () => {
  assertEquals(classifyError(new Error("Rate limit exceeded (429)")).class, "rate_limit");
  assertEquals(classifyError(new Error("This model exceeds the maximum context length")).class, "context_overflow");
  assertEquals(classifyError(new Error("Provider HTTP 503: unavailable")).class, "transient");
  assertEquals(classifyError(new Error("Invalid request payload")).class, "permanent");
  assertEquals(classifyError(new TypeError("bad type")).class, "permanent");
});

Deno.test("error taxonomy: connection-death errors classify as retryable transient", () => {
  const connectionErrors = [
    "error reading a body from connection",
    "connection was closed before message completed",
    "socket hang up",
    "EPIPE: broken pipe",
    "ECONNABORTED: software caused connection abort",
    "network error",
  ];
  for (const msg of connectionErrors) {
    const result = classifyError(new Error(msg));
    assertEquals(result.class, "transient", `"${msg}" should be transient`);
    assertEquals(result.retryable, true, `"${msg}" should be retryable`);
  }
});

Deno.test("error taxonomy: APICallError uses structured status codes before string matching", () => {
  const rateLimited = classifyError(new APICallError({
    statusCode: 429,
    message: "Too many requests",
    url: "http://api.test",
    requestBodyValues: {},
    isRetryable: true,
  }));
  const unauthorized = classifyError(new APICallError({
    statusCode: 401,
    message: "Unauthorized",
    url: "http://api.test",
    requestBodyValues: {},
    isRetryable: false,
  }));
  const contextOverflow = classifyError(new APICallError({
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

Deno.test("error taxonomy: SDK-specific auth, no-content, and missing-model errors stay stable", () => {
  assertEquals(
    classifyError(new LoadAPIKeyError({ message: "Missing OPENAI_API_KEY" })).class,
    "permanent",
  );
  assertEquals(
    classifyError(new NoContentGeneratedError({ message: "No output generated" })).class,
    "transient",
  );
  assertEquals(
    classifyError(
      new NoSuchModelError({
        message: "Model not found",
        modelId: "missing",
        modelType: "languageModel",
      }),
    ).class,
    "permanent",
  );
});

Deno.test("error taxonomy: recovery hints cover filesystem and command errors", () => {
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

Deno.test("error taxonomy: recovery hints cover network, auth, schema, and user-denial flows", () => {
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
