import { VERSION } from "../../version.ts";
import { getPlatform } from "../../platform/platform.ts";

const CLI_ENTRY_URL = new URL("../cli/cli.ts", import.meta.url);

export interface RuntimeHostIdentity {
  version: string;
  buildId: string;
}

let cachedRuntimeHostIdentity: Promise<RuntimeHostIdentity> | null = null;

export function isDenoExecutable(execPath: string): boolean {
  return /(?:^|\/|\\)deno(?:\.exe)?$/i.test(execPath);
}

export function resolveRuntimeHostArtifactPath(): string {
  const platform = getPlatform();
  const execPath = platform.process.execPath();
  if (!isDenoExecutable(execPath)) {
    return execPath;
  }
  return platform.path.fromFileUrl(CLI_ENTRY_URL);
}

export function buildRuntimeServeCommand(): string[] {
  const platform = getPlatform();
  const execPath = platform.process.execPath();
  if (!isDenoExecutable(execPath)) {
    return [execPath, "serve"];
  }
  return [execPath, "run", "-A", resolveRuntimeHostArtifactPath(), "serve"];
}

function buildRuntimeHostFingerprint(
  artifactPath: string,
  size: number,
  mtimeMs: number,
): string {
  return [VERSION, artifactPath, String(size), String(mtimeMs)].join("|");
}

export async function getRuntimeHostIdentity(): Promise<RuntimeHostIdentity> {
  if (!cachedRuntimeHostIdentity) {
    cachedRuntimeHostIdentity = (async () => {
      const platform = getPlatform();
      const artifactPath = resolveRuntimeHostArtifactPath();
      try {
        const info = await platform.fs.stat(artifactPath);
        return {
          version: VERSION,
          buildId: buildRuntimeHostFingerprint(
            artifactPath,
            info.size,
            info.mtimeMs ?? 0,
          ),
        };
      } catch {
        return {
          version: VERSION,
          buildId: buildRuntimeHostFingerprint(artifactPath, 0, 0),
        };
      }
    })();
  }
  return await cachedRuntimeHostIdentity;
}
