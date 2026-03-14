import { VERSION } from "../../version.ts";
import { getPlatform } from "../../platform/platform.ts";

const CLI_ENTRY_URL = new URL("../cli/cli.ts", import.meta.url);

export interface RuntimeHostIdentity {
  version: string;
  buildId: string;
}

interface ParsedRuntimeHostBuildId {
  version: string;
  artifactPath: string;
  artifactBaseName: string;
  size: number;
  mtimeMs: number;
  kind: "source" | "binary";
}

let cachedRuntimeHostIdentity: Promise<RuntimeHostIdentity> | null = null;

function isDenoExecutable(execPath: string): boolean {
  return /(?:^|\/|\\)deno(?:\.exe)?$/i.test(execPath);
}

function resolveRuntimeHostArtifactPath(): string {
  const platform = getPlatform();
  const execPath = platform.process.execPath();
  if (!isDenoExecutable(execPath)) {
    return execPath;
  }
  return platform.path.fromFileUrl(CLI_ENTRY_URL);
}

function getSourceFingerprintRoot(): string {
  return getPlatform().path.fromFileUrl(new URL("../../..", CLI_ENTRY_URL));
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

function parseRuntimeHostBuildId(
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
  // but the shipped artifact kind, size, and timestamp still match this build.
  // This avoids silently attaching to stale runtime hosts after a rebuild that
  // happens to keep the same file size.
  return expected.version === actual.version &&
    expected.kind === actual.kind &&
    expected.size === actual.size &&
    expected.mtimeMs === actual.mtimeMs;
}

export async function getRuntimeHostIdentity(): Promise<RuntimeHostIdentity> {
  if (!cachedRuntimeHostIdentity) {
    cachedRuntimeHostIdentity = (async () => {
      const platform = getPlatform();
      const artifactPath = resolveRuntimeHostArtifactPath();
      try {
        const info = await platform.fs.stat(artifactPath);
        const fingerprint = isDenoExecutable(platform.process.execPath())
          ? await computeSourceTreeFingerprint()
          : { size: info.size, mtimeMs: info.mtimeMs ?? 0 };
        return {
          version: VERSION,
          buildId: buildRuntimeHostFingerprint(
            artifactPath,
            fingerprint.size,
            fingerprint.mtimeMs,
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

async function computeSourceTreeFingerprint(): Promise<{
  size: number;
  mtimeMs: number;
}> {
  const platform = getPlatform();
  const root = getSourceFingerprintRoot();
  let totalSize = 0;
  let latestMtimeMs = 0;

  const walk = async (dir: string): Promise<void> => {
    for await (const entry of platform.fs.readDir(dir)) {
      const path = platform.path.join(dir, entry.name);
      if (entry.isDirectory) {
        await walk(path);
        continue;
      }
      if (!entry.isFile) continue;
      const info = await platform.fs.stat(path);
      totalSize += info.size;
      latestMtimeMs = Math.max(latestMtimeMs, info.mtimeMs ?? 0);
    }
  };

  await walk(root);
  return { size: totalSize, mtimeMs: latestMtimeMs };
}
