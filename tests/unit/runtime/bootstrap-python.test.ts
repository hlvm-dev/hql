import { assertEquals } from "jsr:@std/assert";
import {
  getModelsDir,
  getRuntimeDir,
  resetHlvmDirCacheForTests,
  setHlvmDirForTests,
} from "../../../src/common/paths.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  LOCAL_FALLBACK_IDENTITY,
  LOCAL_FALLBACK_MODEL,
  writeBootstrapManifest,
} from "../../../src/hlvm/runtime/bootstrap-manifest.ts";
import { verifyBootstrap } from "../../../src/hlvm/runtime/bootstrap-verify.ts";
import {
  readPinnedPythonSidecarRequirements,
  readPinnedPythonVersion,
  readPinnedUvVersion,
} from "../../../src/hlvm/runtime/python-runtime.ts";
import { VERSION } from "../../../src/common/version.ts";

async function hashFile(path: string): Promise<string> {
  const bytes = await getPlatform().fs.readFile(path);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeRequirementsText(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

async function withTempHlvmDir(
  fn: () => Promise<void>,
): Promise<void> {
  const platform = getPlatform();
  const tempDir = await platform.fs.makeTempDir({ prefix: "hlvm-bootstrap-" });
  setHlvmDirForTests(tempDir);
  try {
    await fn();
  } finally {
    resetHlvmDirCacheForTests();
    await platform.fs.remove(tempDir, { recursive: true }).catch(() => {});
  }
}

async function writeExecutable(path: string, body: string): Promise<void> {
  const platform = getPlatform();
  await platform.fs.mkdir(platform.path.dirname(path), { recursive: true });
  await platform.fs.writeTextFile(path, body);
  await platform.fs.chmod(path, 0o755).catch(() => {});
}

async function seedVerifiedEngineAndModel(): Promise<string> {
  const platform = getPlatform();
  const enginePath = platform.path.join(getRuntimeDir(), "engine", "ollama");
  await writeExecutable(enginePath, "#!/bin/sh\nexit 0\n");

  const modelManifestPath = platform.path.join(
    getModelsDir(),
    "manifests",
    "registry.ollama.ai",
    "library",
    "gemma4",
    "e2b",
  );
  await platform.fs.mkdir(platform.path.dirname(modelManifestPath), {
    recursive: true,
  });
  await platform.fs.writeTextFile(
    modelManifestPath,
    JSON.stringify({
      layers: [
        {
          mediaType: "application/vnd.ollama.image.model",
          digest: `${LOCAL_FALLBACK_IDENTITY.modelDigestPrefix}deadbeef`,
          size: LOCAL_FALLBACK_IDENTITY.publishedTotalSizeBytes,
        },
      ],
    }),
  );

  return enginePath;
}

Deno.test("bootstrap verification marks legacy engine+model installs as degraded when Python sidecar is missing", async () => {
  await withTempHlvmDir(async () => {
    const enginePath = await seedVerifiedEngineAndModel();
    const engineHash = await hashFile(enginePath);
    const now = new Date().toISOString();

    await writeBootstrapManifest({
      state: "verified",
      engine: { adapter: "ollama", path: enginePath, hash: engineHash },
      models: [{
        modelId: LOCAL_FALLBACK_MODEL,
        size: LOCAL_FALLBACK_IDENTITY.publishedTotalSizeBytes,
        hash: `${LOCAL_FALLBACK_IDENTITY.modelDigestPrefix}deadbeef`,
      }],
      buildId: VERSION,
      createdAt: now,
      lastVerifiedAt: now,
    });

    const result = await verifyBootstrap();
    assertEquals(result.engineOk, true);
    assertEquals(result.modelOk, true);
    assertEquals(result.pythonOk, false);
    assertEquals(result.state, "degraded");
  });
});

Deno.test("bootstrap verification accepts a valid managed Python sidecar runtime", async () => {
  await withTempHlvmDir(async () => {
    if (getPlatform().build.os === "windows") {
      return;
    }

    const platform = getPlatform();
    const enginePath = await seedVerifiedEngineAndModel();
    const engineHash = await hashFile(enginePath);
    const pythonVersion = await readPinnedPythonVersion();
    const uvVersion = await readPinnedUvVersion();
    const requirements = normalizeRequirementsText(
      await readPinnedPythonSidecarRequirements(),
    );

    const uvPath = platform.path.join(getRuntimeDir(), "python", "uv", "uv");
    await writeExecutable(
      uvPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "uv ${uvVersion}"
fi
exit 0
`,
    );

    const pythonPath = platform.path.join(
      getRuntimeDir(),
      "python",
      "venv",
      "bin",
      "python",
    );
    await writeExecutable(
      pythonPath,
      `#!/bin/sh
if [ "$1" = "-c" ]; then
  case "$2" in
    *importlib.metadata*)
      echo "ok"
      ;;
    *version_info*)
      echo "${pythonVersion}"
      ;;
    *)
      echo "ok"
      ;;
  esac
  exit 0
fi
echo "${pythonVersion}"
exit 0
`,
    );

    const requirementsPath = platform.path.join(
      getRuntimeDir(),
      "python",
      "requirements.txt",
    );
    await platform.fs.mkdir(platform.path.dirname(requirementsPath), {
      recursive: true,
    });
    await platform.fs.writeTextFile(requirementsPath, requirements);

    const now = new Date().toISOString();
    await writeBootstrapManifest({
      state: "verified",
      engine: { adapter: "ollama", path: enginePath, hash: engineHash },
      models: [{
        modelId: LOCAL_FALLBACK_MODEL,
        size: LOCAL_FALLBACK_IDENTITY.publishedTotalSizeBytes,
        hash: `${LOCAL_FALLBACK_IDENTITY.modelDigestPrefix}deadbeef`,
      }],
      python: {
        runtime: "cpython",
        version: pythonVersion,
        uvVersion,
        uvPath,
        installDir: platform.path.join(getRuntimeDir(), "python", "cpython"),
        environmentPath: platform.path.join(getRuntimeDir(), "python", "venv"),
        interpreterPath: pythonPath,
        hash: await hashFile(pythonPath),
        requirementsPath,
        requirementsHash: await hashFile(requirementsPath),
        packages: requirements
          .trim()
          .split("\n")
          .filter(Boolean),
      },
      buildId: VERSION,
      createdAt: now,
      lastVerifiedAt: now,
    });

    const result = await verifyBootstrap();
    assertEquals(result.engineOk, true);
    assertEquals(result.modelOk, true);
    assertEquals(result.pythonOk, true);
    assertEquals(result.state, "verified");
  });
});
