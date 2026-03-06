import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  compareVersions,
  incrementPatchVersion,
  resolveNextPublishVersion,
} from "../../../src/hlvm/cli/publish/utils.ts";
import { captureConsole } from "../helpers.ts";

Deno.test("publish utils: incrementPatchVersion advances stable versions and normalizes edge cases", () => {
  assertEquals(incrementPatchVersion("1.0.0"), "1.0.1");
  assertEquals(incrementPatchVersion("1.0.99"), "1.0.100");
  assertEquals(incrementPatchVersion("1.2.3-beta.1"), "1.2.3");
  assertEquals(incrementPatchVersion("invalid"), "0.0.1");
  assertEquals(incrementPatchVersion(""), "0.0.1");
});

Deno.test("publish utils: compareVersions orders semver values and safely falls back for invalid strings", () => {
  assertEquals(compareVersions("1.0.0", "2.0.0") < 0, true);
  assertEquals(compareVersions("1.0.1", "1.0.0") > 0, true);
  assertEquals(compareVersions("1.0.0-alpha", "1.0.0") < 0, true);
  assertEquals(compareVersions("1.0.0", "1.0.0"), 0);
  assertEquals(compareVersions("abc", "xyz") < 0, true);
});

Deno.test("publish utils: resolveNextPublishVersion auto-increments the highest known version", async () => {
  assertEquals(
    await resolveNextPublishVersion(
      "1.2.3",
      "1.0.0",
      (_message, defaultValue) => Promise.resolve(defaultValue),
      incrementPatchVersion,
      "jsr",
    ),
    "1.2.4",
  );

  assertEquals(
    await resolveNextPublishVersion(
      "1.0.0",
      "1.0.0",
      (_message, defaultValue) => Promise.resolve(defaultValue),
      incrementPatchVersion,
      "npm",
    ),
    "1.0.1",
  );
});

Deno.test("publish utils: resolveNextPublishVersion handles single-source and empty fallbacks", async () => {
  assertEquals(
    await resolveNextPublishVersion(
      "2.0.0",
      null,
      (_message, defaultValue) => Promise.resolve(defaultValue),
      incrementPatchVersion,
      "npm",
    ),
    "2.0.1",
  );

  assertEquals(
    await resolveNextPublishVersion(
      null,
      "0.5.0",
      (_message, defaultValue) => Promise.resolve(defaultValue),
      incrementPatchVersion,
      "npm",
    ),
    "0.5.1",
  );

  assertEquals(
    await resolveNextPublishVersion(
      null,
      null,
      (_message, defaultValue) => Promise.resolve(defaultValue),
      incrementPatchVersion,
      "jsr",
    ),
    "0.0.1",
  );
});

Deno.test("publish utils: resolveNextPublishVersion prompts when remote lags the local version", async () => {
  let promptedMessage = "";
  let promptedDefault = "";

  const { result: chosen, warnings } = await captureConsole(
    () =>
      resolveNextPublishVersion(
        "1.0.0",
        "1.2.3",
        (message, defaultValue) => {
          promptedMessage = message;
          promptedDefault = defaultValue;
          return Promise.resolve("1.2.4");
        },
        incrementPatchVersion,
        "jsr",
      ),
    ["warn"],
  );

  assertEquals(chosen, "1.2.4");
  assertEquals(promptedDefault, "1.2.4");
  assertStringIncludes(promptedMessage, "Remote jsr version (1.0.0) is lower");
  assertStringIncludes(warnings, "Remote jsr version (1.0.0) is lower");
});
