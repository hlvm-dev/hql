import { getMcpConfigPath } from "../../src/common/paths.ts";
import { getPlatform } from "../../src/platform/platform.ts";

const platform = getPlatform();

type FixtureServerOptions = {
  allowEnv?: string[];
  env?: Record<string, string>;
};

export const FIXTURE_SERVER_PATH = platform.path.resolve(
  "tests",
  "fixtures",
  "mcp-server.ts",
);

export function fixtureServer(
  name: string,
  options: FixtureServerOptions = {},
) {
  const allowEnv = options.allowEnv?.length
    ? [`--allow-env=${options.allowEnv.join(",")}`]
    : [];

  return {
    name,
    command: ["deno", "run", ...allowEnv, FIXTURE_SERVER_PATH],
    ...(options.env ? { env: options.env } : {}),
  };
}

export async function writeMcpConfig(servers: unknown): Promise<void> {
  const configPath = getMcpConfigPath();
  await platform.fs.mkdir(platform.path.dirname(configPath), {
    recursive: true,
  });
  await platform.fs.writeTextFile(
    configPath,
    JSON.stringify({ version: 1, servers }),
  );
}
