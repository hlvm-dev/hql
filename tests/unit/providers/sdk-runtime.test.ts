import { assertRejects, assertStringIncludes } from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import { ValidationError } from "../../../src/common/error.ts";
import { createSdkLanguageModel } from "../../../src/hlvm/providers/sdk-runtime.ts";

async function withEnvVarCleared<T>(
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const platform = getPlatform();
  const original = platform.env.get(key);
  platform.env.delete(key);
  try {
    return await run();
  } finally {
    if (original === undefined) platform.env.delete(key);
    else platform.env.set(key, original);
  }
}

Deno.test("createSdkLanguageModel explains missing provider API key", async () => {
  await withEnvVarCleared("OPENAI_API_KEY", async () => {
    const error = await assertRejects(
      () =>
        createSdkLanguageModel({ providerName: "openai", modelId: "gpt-test" }),
      ValidationError,
    );
    assertStringIncludes(error.message, "OPENAI_API_KEY is not set");
  });
});
