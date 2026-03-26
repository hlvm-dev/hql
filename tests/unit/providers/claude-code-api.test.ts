import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { ProviderErrorCode } from "../../../src/common/error-codes.ts";
import { RuntimeError } from "../../../src/common/error.ts";
import { http } from "../../../src/common/http-client.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  checkStatus,
  listModels,
} from "../../../src/hlvm/providers/claude-code/api.ts";
import { clearTokenCache } from "../../../src/hlvm/providers/claude-code/auth.ts";

Deno.test("claude-code listModels surfaces expired OAuth as auth failure", async () => {
  const originalFetchRaw = http.fetchRaw.bind(http);
  const platform = getPlatform();
  const previousToken = platform.env.get("CLAUDE_CODE_TOKEN");

  platform.env.set("CLAUDE_CODE_TOKEN", "test-claude-code-token");
  clearTokenCache();
  (http as { fetchRaw: typeof http.fetchRaw }).fetchRaw = async () =>
    new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "authentication_error",
          message:
            "OAuth token has expired. Please obtain a new token or refresh your existing token.",
        },
      }),
      {
        status: 401,
        headers: { "content-type": "application/json" },
      },
    );

  try {
    const error = await assertRejects(
      () => listModels("https://api.anthropic.com"),
      RuntimeError,
    );
    assertEquals(error.code, ProviderErrorCode.AUTH_FAILED);
    assertStringIncludes(error.message, "claude login");
    assertStringIncludes(error.message, "expired");
  } finally {
    (http as { fetchRaw: typeof http.fetchRaw }).fetchRaw = originalFetchRaw;
    clearTokenCache();
    if (previousToken === undefined) {
      platform.env.delete("CLAUDE_CODE_TOKEN");
    } else {
      platform.env.set("CLAUDE_CODE_TOKEN", previousToken);
    }
  }
});

Deno.test("claude-code listModels surfaces provider outages instead of empty catalogs", async () => {
  const originalFetchRaw = http.fetchRaw.bind(http);
  const platform = getPlatform();
  const previousToken = platform.env.get("CLAUDE_CODE_TOKEN");

  platform.env.set("CLAUDE_CODE_TOKEN", "test-claude-code-token");
  clearTokenCache();
  (http as { fetchRaw: typeof http.fetchRaw }).fetchRaw = async () =>
    new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "overloaded_error",
          message: "Service is temporarily overloaded.",
        },
      }),
      {
        status: 503,
        headers: { "content-type": "application/json" },
      },
    );

  try {
    const error = await assertRejects(
      () => listModels("https://api.anthropic.com"),
      RuntimeError,
    );
    assertEquals(error.code, ProviderErrorCode.SERVICE_UNAVAILABLE);
    assertStringIncludes(error.message, "temporarily overloaded");
  } finally {
    (http as { fetchRaw: typeof http.fetchRaw }).fetchRaw = originalFetchRaw;
    clearTokenCache();
    if (previousToken === undefined) {
      platform.env.delete("CLAUDE_CODE_TOKEN");
    } else {
      platform.env.set("CLAUDE_CODE_TOKEN", previousToken);
    }
  }
});

Deno.test("claude-code listModels retries once after auth failure with refreshed token", async () => {
  const originalFetchRaw = http.fetchRaw.bind(http);
  const platform = getPlatform();
  const previousToken = platform.env.get("CLAUDE_CODE_TOKEN");
  let callCount = 0;

  platform.env.set("CLAUDE_CODE_TOKEN", "stale-token");
  clearTokenCache();
  (http as { fetchRaw: typeof http.fetchRaw }).fetchRaw = async (
    _url,
    init,
  ) => {
    callCount++;
    const authHeader = init?.headers &&
        typeof init.headers === "object" &&
        "Authorization" in init.headers
      ? String((init.headers as Record<string, string>).Authorization)
      : "";
    if (authHeader === "Bearer stale-token") {
      platform.env.set("CLAUDE_CODE_TOKEN", "fresh-token");
      return new Response(
        JSON.stringify({
          type: "error",
          error: {
            type: "authentication_error",
            message: "OAuth token has expired.",
          },
        }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response(
      JSON.stringify({
        data: [
          {
            id: "claude-haiku-4-5-20251001",
            display_name: "Claude Haiku 4.5",
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const models = await listModels("https://api.anthropic.com");
    assertEquals(callCount, 2);
    assertEquals(models.length, 1);
    assertEquals(models[0]?.name, "claude-haiku-4-5-20251001");
  } finally {
    (http as { fetchRaw: typeof http.fetchRaw }).fetchRaw = originalFetchRaw;
    clearTokenCache();
    if (previousToken === undefined) {
      platform.env.delete("CLAUDE_CODE_TOKEN");
    } else {
      platform.env.set("CLAUDE_CODE_TOKEN", previousToken);
    }
  }
});

Deno.test("claude-code checkStatus retries once before reporting auth unavailable", async () => {
  const originalFetchRaw = http.fetchRaw.bind(http);
  const platform = getPlatform();
  const previousToken = platform.env.get("CLAUDE_CODE_TOKEN");
  let callCount = 0;

  platform.env.set("CLAUDE_CODE_TOKEN", "stale-token");
  clearTokenCache();
  (http as { fetchRaw: typeof http.fetchRaw }).fetchRaw = async (
    _url,
    init,
  ) => {
    callCount++;
    const authHeader = init?.headers &&
        typeof init.headers === "object" &&
        "Authorization" in init.headers
      ? String((init.headers as Record<string, string>).Authorization)
      : "";
    if (authHeader === "Bearer stale-token") {
      platform.env.set("CLAUDE_CODE_TOKEN", "fresh-token");
      return new Response("", { status: 401 });
    }
    return new Response(
      JSON.stringify({ data: [] }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const status = await checkStatus("https://api.anthropic.com");
    assertEquals(callCount, 2);
    assertEquals(status.available, true);
    assertEquals(status.error, undefined);
  } finally {
    (http as { fetchRaw: typeof http.fetchRaw }).fetchRaw = originalFetchRaw;
    clearTokenCache();
    if (previousToken === undefined) {
      platform.env.delete("CLAUDE_CODE_TOKEN");
    } else {
      platform.env.set("CLAUDE_CODE_TOKEN", previousToken);
    }
  }
});
