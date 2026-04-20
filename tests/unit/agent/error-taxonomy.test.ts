import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  APICallError,
  LoadAPIKeyError,
  NoContentGeneratedError,
  NoSuchModelError,
} from "ai";
import {
  AgentStreamError,
  BootstrapError,
  buildEditFileRecovery,
  CancellationError,
  classifyError,
  classifyFromApiResponseBody,
  describeErrorForDisplay,
  getRecoveryHint,
  HINTS,
  RECOVERY_HINT_RULES,
  renderEditFileRecoveryPrompt,
  ToolError,
} from "../../../src/hlvm/agent/error-taxonomy.ts";
import { RuntimeError } from "../../../src/common/error.ts";
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

Deno.test("error taxonomy: bootstrap-in-progress readiness errors classify as retryable transient with an AI-runtime hint", async () => {
  const bootstrapMessages = [
    "Local HLVM runtime host is not ready for AI requests: Verified bootstrap not found. Local AI bootstrap is being materialized.",
    "Local HLVM runtime host is not ready for AI requests: AI runtime is still initializing.",
  ];
  for (const msg of bootstrapMessages) {
    const classified = await classifyError(new Error(msg));
    assertEquals(classified.class, "transient", `"${msg}" should be transient`);
    assertEquals(classified.retryable, true, `"${msg}" should be retryable`);

    const described = await describeErrorForDisplay(new RuntimeError(msg));
    assertEquals(described.class, "transient");
    assertEquals(described.retryable, true);
    assertEquals(described.hint, HINTS.AI_RUNTIME_NOT_READY);
  }
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

Deno.test("error taxonomy: every RECOVERY_HINT_RULES entry is reachable (no rule shadowed by an earlier, less-specific one)", () => {
  const unreachable: string[] = [];
  for (let i = 0; i < RECOVERY_HINT_RULES.length; i++) {
    const [keywords, expectedHint] = RECOVERY_HINT_RULES[i];
    const probe = keywords.join(" ");
    const actual = getRecoveryHint(probe);
    if (actual !== expectedHint) {
      unreachable.push(
        `rule #${i} [${keywords.join(", ")}] -> expected ${describeHint(expectedHint)} but got ${describeHint(actual)}`,
      );
    }
  }
  assertEquals(
    unreachable,
    [],
    `Some RECOVERY_HINT_RULES entries are shadowed by earlier rules:\n  ${unreachable.join("\n  ")}`,
  );
});

function describeHint(hint: string | null): string {
  if (hint === null) return "null";
  const key = Object.entries(HINTS).find(([, v]) => v === hint)?.[0];
  return key ? `HINTS.${key}` : JSON.stringify(hint.slice(0, 40));
}

Deno.test("error taxonomy: specific not-found rules (model / python / uv) do not fall through to the filesystem hint", () => {
  assertStringIncludes(
    getRecoveryHint("Ollama model gemma4:e2b not found in local registry") ?? "",
    "hlvm pull",
  );
  assertStringIncludes(
    getRecoveryHint("python not found on PATH") ?? "",
    "bootstrap --repair",
  );
  assertStringIncludes(
    getRecoveryHint("uv is not installed") ?? "",
    "bootstrap --repair",
  );
});

Deno.test("error taxonomy: HTTP 403 with 'permission denied' body gets auth hint, not filesystem advice", () => {
  const hint = getRecoveryHint("HTTP 403 Forbidden: permission denied by provider") ?? "";
  assertStringIncludes(hint, "credentials");
  assertEquals(hint.includes("list_files"), false);
});

Deno.test("error taxonomy: ambiguous 'not found' without a more specific rule returns null instead of the filesystem hint", () => {
  assertEquals(getRecoveryHint("Tool 'search_code' not found"), null);
  assertEquals(getRecoveryHint("method not found"), null);
});

Deno.test("error taxonomy: classifyFromApiResponseBody recognises Anthropic prompt_too_long as context overflow", () => {
  const anthropicBody = JSON.stringify({
    error: { type: "prompt_too_long", message: "Input prompt is too long" },
  });
  const mapped = classifyFromApiResponseBody(anthropicBody);
  assertEquals(mapped?.class, "context_overflow");
  assertEquals(mapped?.hint, HINTS.CONTEXT_OVERFLOW);
});

Deno.test("error taxonomy: classifyFromApiResponseBody recognises OpenAI context_length_exceeded", () => {
  const openaiBody = JSON.stringify({
    error: {
      type: "invalid_request_error",
      code: "context_length_exceeded",
      message: "This model's maximum context length is 8192 tokens...",
    },
  });
  const mapped = classifyFromApiResponseBody(openaiBody);
  assertEquals(mapped?.class, "context_overflow");
});

Deno.test("error taxonomy: Claude OAuth refresh failures stay auth-shaped instead of matching the generic not-found hint", async () => {
  const oauthRefreshFailure = new RuntimeError(
    'OAuth token refresh failed (400). {"error":"invalid_grant","error_description":"Refresh token not found or invalid"} Run `claude login` to re-authenticate.',
  );

  const described = await describeErrorForDisplay(oauthRefreshFailure);

  assertEquals(described.class, "permanent");
  assertEquals(described.retryable, false);
  assertStringIncludes(described.hint ?? "", "Re-authenticate");
  assertEquals(
    described.hint?.includes("path exists") ?? false,
    false,
  );
});

Deno.test("error taxonomy: leans on Deno.errors.* typed errors instead of regex on the message", async () => {
  const notFound = new Deno.errors.NotFound("couldn't open file");
  const notFoundDesc = await describeErrorForDisplay(notFound);
  assertEquals(notFoundDesc.class, "permanent");
  assertEquals(notFoundDesc.retryable, false);
  assertStringIncludes(notFoundDesc.hint ?? "", "path exists");

  const connRefused = new Deno.errors.ConnectionRefused("refused");
  const connDesc = await describeErrorForDisplay(connRefused);
  assertEquals(connDesc.class, "transient");
  assertEquals(connDesc.retryable, true);
  assertStringIncludes(connDesc.hint ?? "", "Connection refused");

  const addrInUse = new Deno.errors.AddrInUse("port busy");
  const addrDesc = await describeErrorForDisplay(addrInUse);
  assertEquals(addrDesc.class, "permanent");
  assertStringIncludes(addrDesc.hint ?? "", "Port is already in use");
});

Deno.test("error taxonomy: Node-compat `err.code` strings classify without reading the message", async () => {
  const enospc = Object.assign(new Error("write failed"), { code: "ENOSPC" });
  const enospcDesc = await describeErrorForDisplay(enospc);
  assertEquals(enospcDesc.class, "permanent");
  assertStringIncludes(enospcDesc.hint ?? "", "Disk is full");

  const dnsFail = Object.assign(new Error("getaddrinfo failed"), {
    code: "ENOTFOUND",
  });
  const dnsDesc = await describeErrorForDisplay(dnsFail);
  assertEquals(dnsDesc.class, "transient");
  assertEquals(dnsDesc.retryable, true);
  assertStringIncludes(dnsDesc.hint ?? "", "DNS");
});

Deno.test("error taxonomy: CancellationError renders as clean `Cancelled.` with no misleading hint", async () => {
  const cancelled = new CancellationError("Runtime host request cancelled.");
  const described = await describeErrorForDisplay(cancelled);
  assertEquals(described.class, "abort");
  assertEquals(described.retryable, false);
  assertEquals(described.hint, null);
  assertStringIncludes(described.message, "cancelled");
});

Deno.test("error taxonomy: BootstrapError picks a phase-appropriate hint and retryable flag", async () => {
  const pull = await describeErrorForDisplay(
    new BootstrapError("Model pull failed (500): unavailable", "model_pull"),
  );
  assertEquals(pull.class, "transient");
  assertEquals(pull.retryable, true);
  assertStringIncludes(pull.hint ?? "", "disk space");

  const manifest = await describeErrorForDisplay(
    new BootstrapError("Pulled but manifest mismatch", "manifest_verify"),
  );
  assertEquals(manifest.class, "permanent");
  assertEquals(manifest.retryable, false);
  assertStringIncludes(manifest.hint ?? "", "hlvm bootstrap --repair");
});

Deno.test("error taxonomy: ToolError with typed originalError derives its hint from the typed error, not regex", async () => {
  const raw = new Deno.errors.PermissionDenied("/etc/shadow");
  const toolErr = new ToolError(
    "cannot read /etc/shadow",
    "read_file",
    "file",
    { originalError: raw },
  );
  const described = await describeErrorForDisplay(toolErr);
  assertEquals(described.class, "permanent");
  assertEquals(described.retryable, false);
  assertStringIncludes(described.hint ?? "", "Permission denied");
});

Deno.test("error taxonomy: AgentStreamError + BootstrapError + ToolError all short-circuit past the REQUEST_FAILED fallback", async () => {
  const misleadingHintFragment = "Restart HLVM so the client";

  const stream = await describeErrorForDisplay(
    new AgentStreamError(
      "Internal HLVM error: boom",
      "unknown",
      false,
      "This looks like an HLVM bug.",
    ),
  );
  assertEquals(
    stream.hint?.includes(misleadingHintFragment) ?? false,
    false,
  );

  const boot = await describeErrorForDisplay(
    new BootstrapError("Bootstrap cancelled.", "model_pull"),
  );
  assertEquals(
    boot.hint?.includes(misleadingHintFragment) ?? false,
    false,
  );

  const tool = await describeErrorForDisplay(
    new ToolError("bad arg", "read_file", "validation"),
  );
  assertEquals(
    tool.hint?.includes(misleadingHintFragment) ?? false,
    false,
  );
});

Deno.test("error taxonomy: walks `.cause` one level to find the platform-typed root error", async () => {
  const root = new Deno.errors.PermissionDenied("can't read /etc/shadow");
  const wrapped = new Error("failed to read config");
  (wrapped as Error & { cause?: unknown }).cause = root;

  const described = await describeErrorForDisplay(wrapped);
  assertStringIncludes(described.hint ?? "", "Permission denied");
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
