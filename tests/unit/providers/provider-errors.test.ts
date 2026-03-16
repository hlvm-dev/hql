import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert";
import { RuntimeError } from "../../../src/common/error.ts";
import {
  ProviderErrorCode,
} from "../../../src/common/error-codes.ts";
import {
  classifyProviderErrorCode,
  throwOnHttpError,
} from "../../../src/hlvm/providers/common.ts";

Deno.test("provider error code classification maps major provider status families", () => {
  assertEquals(classifyProviderErrorCode(401, "bad token"), ProviderErrorCode.AUTH_FAILED);
  assertEquals(classifyProviderErrorCode(403, "forbidden"), ProviderErrorCode.AUTH_FAILED);
  assertEquals(classifyProviderErrorCode(413, "body too large"), ProviderErrorCode.REQUEST_TOO_LARGE);
  assertEquals(classifyProviderErrorCode(408, "timeout"), ProviderErrorCode.REQUEST_TIMEOUT);
  assertEquals(classifyProviderErrorCode(429, "rate limit"), ProviderErrorCode.RATE_LIMITED);
  assertEquals(classifyProviderErrorCode(500, "server down"), ProviderErrorCode.SERVICE_UNAVAILABLE);
  assertEquals(classifyProviderErrorCode(400, "bad request"), ProviderErrorCode.REQUEST_REJECTED);
});

Deno.test("provider error code classification uses message hints when status is missing", () => {
  assertEquals(classifyProviderErrorCode(0, "request payload too large"), ProviderErrorCode.REQUEST_TOO_LARGE);
  assertEquals(classifyProviderErrorCode(0, "rate limit exceeded"), ProviderErrorCode.RATE_LIMITED);
});

Deno.test("throwOnHttpError wraps provider HTTP failures with PRV runtime error codes", async () => {
  const body = {
    error: {
      message: "The provider quota has been exceeded.",
      type: "rate_limit_error",
      code: "rate_limit_exceeded",
    },
  };
  const response = new Response(JSON.stringify(body), {
    status: 429,
    headers: {
      "content-type": "application/json",
      "retry-after": "20",
    },
  });

  const error = await assertRejects(
    () => throwOnHttpError(response, "openai"),
    RuntimeError,
  );
  assertEquals(error.code, ProviderErrorCode.RATE_LIMITED);
  assertStringIncludes(error.message, "quota has been exceeded");
  assertStringIncludes(error.message, "retry-after");
});
