import { VERSION } from "../../version.ts";
import { getPlatform } from "../../platform/platform.ts";

const CLI_ENTRY_URL = new URL("../cli/cli.ts", import.meta.url);

export interface RuntimeHostIdentity {
  version: string;
  buildId: string;
}

export interface ParsedRuntimeHostBuildId {
  version: string;
  artifactPath: string;
  artifactBaseName: string;
  size: number;
  mtimeMs: number;
  kind: "source" | "binary";
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

export function parseRuntimeHostBuildId(
  buildId: string,
): ParsedRuntimeHostBuildId | null {
  const [version, artifactPath, sizeText, mtimeText] = buildId.split("|");
  if (!version || !artifactPath || !sizeText || !mtimeText) {
    return null;
  }

  const size = Number.parseInt(sizeText, 10);
  const mtimeMs = Number.parseInt(mtimeText, 10);
  if (!Number.isFinite(size) || !Number.isFinite(mtimeMs)) {
    return null;
  }

  const platform = getPlatform();
  const artifactBaseName = platform.path.basename(artifactPath);
  return {
    version,
    artifactPath,
    artifactBaseName,
    size,
    mtimeMs,
    kind: artifactBaseName === "cli.ts" ? "source" : "binary",
  };
}

export function areRuntimeHostBuildIdsCompatible(
  expectedBuildId: string,
  actualBuildId: string,
): boolean {
  if (expectedBuildId === actualBuildId) return true;

  const expected = parseRuntimeHostBuildId(expectedBuildId);
  const actual = parseRuntimeHostBuildId(actualBuildId);
  if (!expected || !actual) return false;

  // Accept equivalent compiled/source artifacts when the executable path differs
  // but the shipped artifact kind and size still match this build.
  return expected.version === actual.version &&
    expected.kind === actual.kind &&
    expected.size === actual.size;
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
