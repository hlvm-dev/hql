import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { http } from "../../../src/common/http-client.ts";
import { VERSION } from "../../../src/common/version.ts";
import { update } from "../../../src/hlvm/cli/commands/upgrade.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import type {
  PlatformCommandOptions,
  PlatformCommandProcess,
} from "../../../src/platform/types.ts";
import { withCapturedOutput } from "../../shared/light-helpers.ts";

const CLI_PATH = getPlatform().path.fromFileUrl(
  new URL("../../../src/hlvm/cli/cli.ts", import.meta.url),
);

function fakeRelease(tag: string) {
  return {
    tag_name: tag,
    html_url: `https://github.com/hlvm-dev/hql/releases/tag/${tag}`,
  };
}

function withFakeHttpGet<T>(
  fake: (url: string) => T,
  fn: () => Promise<void>,
): Promise<void> {
  const original = http.get.bind(http);
  http.get = (async (url: string) => fake(url)) as typeof http.get;
  return fn().finally(() => {
    http.get = original;
  });
}

function withFakeCommandRun(
  fake: (options: PlatformCommandOptions) => PlatformCommandProcess,
  fn: () => Promise<void>,
): Promise<void> {
  const command = getPlatform().command;
  const original = command.run;
  command.run = fake;
  return fn().finally(() => {
    command.run = original;
  });
}

async function runCli(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await getPlatform().command.output({
    cmd: [getPlatform().process.execPath(), "run", "-A", CLI_PATH, ...args],
    stdout: "piped",
    stderr: "piped",
  });
  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

Deno.test("update --check reports the CLI update command without running the installer", async () => {
  let installerCalls = 0;

  await withFakeHttpGet(
    () => fakeRelease("v99.0.0"),
    async () => {
      await withFakeCommandRun(
        () => {
          installerCalls += 1;
          return {
            status: Promise.resolve({ success: true, code: 0 }),
          };
        },
        async () => {
          await withCapturedOutput(async (output) => {
            await update(["--check"]);

            assertEquals(installerCalls, 0);
            assertStringIncludes(output(), `Current version: ${VERSION}`);
            assertStringIncludes(output(), "New version available: 99.0.0");
            assertStringIncludes(output(), "Run 'hlvm update' to install it.");
          });
        },
      );
    },
  );
});

Deno.test("update runs the installer with the pinned release version", async () => {
  let installerOptions: PlatformCommandOptions | null = null;

  await withFakeHttpGet(
    () => fakeRelease("v99.0.0"),
    async () => {
      await withFakeCommandRun(
        (options) => {
          installerOptions = options;
          return {
            status: Promise.resolve({ success: true, code: 0 }),
          };
        },
        async () => {
          await withCapturedOutput(async (output) => {
            await update([]);

            assertEquals(
              installerOptions?.env?.HLVM_INSTALL_VERSION,
              "v99.0.0",
            );
            assertEquals(installerOptions?.stdin, "inherit");
            assertEquals(installerOptions?.stdout, "inherit");
            assertEquals(installerOptions?.stderr, "inherit");
            if (Deno.build.os === "windows") {
              assertEquals(installerOptions?.cmd[0], "powershell");
            } else {
              assertEquals(installerOptions?.cmd, [
                "sh",
                "-c",
                "curl -fsSL https://hlvm.dev/install.sh | sh",
              ]);
            }
            assertStringIncludes(output(), `Current version: ${VERSION}`);
            assertStringIncludes(output(), "New version available: 99.0.0");
            assertStringIncludes(output(), "Updating to 99.0.0...");
          });
        },
      );
    },
  );
});

Deno.test("upgrade is rejected and points callers to update", async () => {
  const result = await runCli(["upgrade", "--help"]);
  const output = result.stdout + result.stderr;

  assertEquals(result.code, 1);
  assertStringIncludes(output, "Unknown command: upgrade");
  assertStringIncludes(output, "Use `hlvm update`.");
});
