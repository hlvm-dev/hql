import { assertEquals } from "jsr:@std/assert";
import {
  attemptCloudAuthRecovery,
  type CloudAuthRecoveryDeps,
} from "../../../src/hlvm/cli/commands/ask.ts";

function createDeps(
  overrides: Partial<CloudAuthRecoveryDeps> = {},
): {
  deps: CloudAuthRecoveryDeps;
  logs: string[];
  writes: string[];
  calls: string[];
} {
  const logs: string[] = [];
  const writes: string[] = [];
  const calls: string[] = [];

  const deps: CloudAuthRecoveryDeps = {
    isCloudModelId: () => true,
    isInteractiveTerminal: () => true,
    isAuthErrorMessage: () => true,
    runSignin: () => {
      calls.push("signin");
      return Promise.resolve(true);
    },
    verifyCloudAccess: () => {
      calls.push("verify");
      return Promise.resolve(true);
    },
    executeQuery: () => {
      calls.push("execute");
      return Promise.resolve();
    },
    logRaw: (message: string) => logs.push(message),
    writeRaw: (message: string) => writes.push(message),
    ...overrides,
  };

  return { deps, logs, writes, calls };
}

Deno.test("attemptCloudAuthRecovery: ignores non-Error input", async () => {
  const { deps } = createDeps();
  const result = await attemptCloudAuthRecovery(
    {
      executionError: "not-an-error",
      resolvedModel: "ollama/deepseek-v3.1:671b-cloud",
      streamedTokens: false,
    },
    deps,
  );
  assertEquals(result.handled, false);
  assertEquals(result.recovered, false);
});

Deno.test("attemptCloudAuthRecovery: skips non-cloud model", async () => {
  const { deps, calls } = createDeps({
    isCloudModelId: () => false,
  });
  const result = await attemptCloudAuthRecovery(
    {
      executionError: new Error("401 Unauthorized"),
      resolvedModel: "ollama/llama3.1:8b",
      streamedTokens: false,
    },
    deps,
  );
  assertEquals(result.handled, false);
  assertEquals(result.recovered, false);
  assertEquals(calls.length, 0);
});

Deno.test("attemptCloudAuthRecovery: skips non-interactive terminal", async () => {
  const { deps, calls } = createDeps({
    isInteractiveTerminal: () => false,
  });
  const result = await attemptCloudAuthRecovery(
    {
      executionError: new Error("401 Unauthorized"),
      resolvedModel: "ollama/deepseek-v3.1:671b-cloud",
      streamedTokens: false,
    },
    deps,
  );
  assertEquals(result.handled, false);
  assertEquals(result.recovered, false);
  assertEquals(calls.length, 0);
});

Deno.test("attemptCloudAuthRecovery: skips non-auth errors", async () => {
  const { deps, calls } = createDeps({
    isAuthErrorMessage: () => false,
  });
  const error = new Error("timeout");
  const result = await attemptCloudAuthRecovery(
    {
      executionError: error,
      resolvedModel: "ollama/deepseek-v3.1:671b-cloud",
      streamedTokens: false,
    },
    deps,
  );
  assertEquals(result.handled, false);
  assertEquals(result.recovered, false);
  assertEquals(result.executionError, error);
  assertEquals(calls.length, 0);
});

Deno.test("attemptCloudAuthRecovery: sign-in failure logs guidance", async () => {
  const { deps, logs, writes, calls } = createDeps({
    runSignin: () => {
      calls.push("signin");
      return Promise.resolve(false);
    },
  });
  const error = new Error("401 Unauthorized");
  const result = await attemptCloudAuthRecovery(
    {
      executionError: error,
      resolvedModel: "ollama/deepseek-v3.1:671b-cloud",
      streamedTokens: true,
    },
    deps,
  );
  assertEquals(result.handled, true);
  assertEquals(result.recovered, false);
  assertEquals(result.executionError, error);
  assertEquals(result.streamedTokens, false);
  assertEquals(writes, ["\n"]);
  assertEquals(
    logs.includes("Sign-in failed. Run `ollama signin` and retry."),
    true,
  );
  assertEquals(calls, ["signin"]);
});

Deno.test("attemptCloudAuthRecovery: verification failure logs guidance", async () => {
  const { deps, logs, calls } = createDeps({
    verifyCloudAccess: () => {
      calls.push("verify");
      return Promise.resolve(false);
    },
  });
  const error = new Error("401 Unauthorized");
  const result = await attemptCloudAuthRecovery(
    {
      executionError: error,
      resolvedModel: "ollama/deepseek-v3.1:671b-cloud",
      streamedTokens: false,
    },
    deps,
  );
  assertEquals(result.handled, true);
  assertEquals(result.recovered, false);
  assertEquals(result.executionError, error);
  assertEquals(
    logs.includes(
      "Cloud sign-in not completed. Open the URL above, then retry.",
    ),
    true,
  );
  assertEquals(calls, ["signin", "verify"]);
});

Deno.test("attemptCloudAuthRecovery: retries successfully after signin", async () => {
  const { deps, logs, calls } = createDeps();
  const result = await attemptCloudAuthRecovery(
    {
      executionError: new Error("401 Unauthorized"),
      resolvedModel: "ollama/deepseek-v3.1:671b-cloud",
      streamedTokens: false,
    },
    deps,
  );
  assertEquals(result.handled, true);
  assertEquals(result.recovered, true);
  assertEquals(result.executionError, null);
  assertEquals(logs.includes("Retrying query...\n"), true);
  assertEquals(calls, ["signin", "verify", "execute"]);
});

Deno.test("attemptCloudAuthRecovery: retry error is surfaced", async () => {
  const retryError = new Error("retry failed");
  const { deps, calls } = createDeps({
    executeQuery: () => {
      calls.push("execute");
      return Promise.reject(retryError);
    },
  });
  const result = await attemptCloudAuthRecovery(
    {
      executionError: new Error("401 Unauthorized"),
      resolvedModel: "ollama/deepseek-v3.1:671b-cloud",
      streamedTokens: false,
    },
    deps,
  );
  assertEquals(result.handled, true);
  assertEquals(result.recovered, false);
  assertEquals(result.executionError, retryError);
  assertEquals(calls, ["signin", "verify", "execute"]);
});
