import {
  ensurePythonRuntimeDir,
  getManagedPythonBinDir,
  getManagedPythonCacheDir,
  getManagedPythonInstallDir,
  getManagedPythonRequirementsPath,
  getManagedPythonVenvDir,
  getManagedUvDir,
} from "../../common/paths.ts";
import { RuntimeError } from "../../common/error.ts";
import { HLVMErrorCode } from "../../common/error-codes.ts";
import { http } from "../../common/http-client.ts";
import { getPlatform } from "../../platform/platform.ts";
import { log } from "../api/log.ts";
import type { BootstrapPythonRecord } from "./bootstrap-manifest.ts";

interface PythonSidecarPackage {
  distribution: string;
  version: string;
  module: string;
}

const UV_INSTALL_TIMEOUT_MS = 300_000;
const PYTHON_ENV_TIMEOUT_MS = 900_000;

const SIDECAR_IMPORTS: Record<string, string> = {
  "pypdf": "pypdf",
  "pdfplumber": "pdfplumber",
  "python-pptx": "pptx",
  "python-docx": "docx",
  "openpyxl": "openpyxl",
  "defusedxml": "defusedxml",
  "Pillow": "PIL",
  "icalendar": "icalendar",
  "vobject": "vobject",
  "beautifulsoup4": "bs4",
  "Jinja2": "jinja2",
  "striprtf": "striprtf.striprtf",
  "fastmcp": "fastmcp",
  "pydantic": "pydantic",
  "PyYAML": "yaml",
};

function getManagedUvBinaryPath(): string {
  const platform = getPlatform();
  return platform.path.join(
    getManagedUvDir(),
    platform.build.os === "windows" ? "uv.exe" : "uv",
  );
}

function bootstrapError(message: string, originalError?: Error): RuntimeError {
  return new RuntimeError(message, {
    code: HLVMErrorCode.BOOTSTRAP_FAILED,
    originalError,
  });
}

export function getManagedPythonExecutablePath(): string {
  const platform = getPlatform();
  return platform.path.join(
    getManagedPythonVenvDir(),
    platform.build.os === "windows" ? "Scripts" : "bin",
    platform.build.os === "windows" ? "python.exe" : "python",
  );
}

function getManagedPythonVersionedExecutablePath(version: string): string {
  const platform = getPlatform();
  const [major = "3", minor = "13"] = version.split(".");
  const binary = `python${major}.${minor}${
    platform.build.os === "windows" ? ".exe" : ""
  }`;
  return platform.path.join(getManagedPythonBinDir(), binary);
}

function buildManagedPythonEnvironment(): Record<string, string> {
  const platform = getPlatform();
  return {
    ...platform.env.toObject(),
    PYTHONNOUSERSITE: "1",
    UV_CACHE_DIR: getManagedPythonCacheDir(),
    UV_NO_MODIFY_PATH: "1",
    UV_PYTHON_BIN_DIR: getManagedPythonBinDir(),
    UV_PYTHON_INSTALL_DIR: getManagedPythonInstallDir(),
  };
}

async function readEmbeddedTextFile(filename: string): Promise<string> {
  const platform = getPlatform();
  const candidates = [
    platform.path.fromFileUrl(new URL(`../../../${filename}`, import.meta.url)),
    platform.path.join(
      platform.path.fromFileUrl(new URL("../../../", import.meta.url)),
      filename,
    ),
  ];

  for (const candidate of candidates) {
    try {
      const content = await platform.fs.readTextFile(candidate);
      if (content.trim()) {
        return content;
      }
    } catch {
      // Try next candidate.
    }
  }

  throw bootstrapError(
    `Could not read embedded Python runtime asset ${filename}. ` +
      "This file must be baked into the binary at compile time.",
  );
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashFile(path: string): Promise<string> {
  return await hashBytes(await getPlatform().fs.readFile(path));
}

async function hashText(text: string): Promise<string> {
  return await hashBytes(new TextEncoder().encode(text));
}

function normalizeRequirementsText(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await getPlatform().fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

function decodeOutput(output: Uint8Array): string {
  return new TextDecoder().decode(output).trim();
}

async function runCommand(
  cmd: string[],
  timeout: number,
  env = buildManagedPythonEnvironment(),
): Promise<string> {
  const result = await getPlatform().command.output({
    cmd,
    env,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    timeout,
  });

  const stdout = decodeOutput(result.stdout);
  const stderr = decodeOutput(result.stderr);

  if (!result.success) {
    throw bootstrapError(stderr || stdout || `Command failed: ${cmd.join(" ")}`);
  }

  return stdout;
}

function getUvInstallerUrl(version: string): string {
  const script = getPlatform().build.os === "windows"
    ? "uv-installer.ps1"
    : "uv-installer.sh";
  return `https://releases.astral.sh/github/uv/releases/download/${version}/${script}`;
}

function getUvInstallerFilename(): string {
  return getPlatform().build.os === "windows"
    ? "uv-installer.ps1"
    : "uv-installer.sh";
}

async function installUvBinary(version: string): Promise<string> {
  const platform = getPlatform();
  const uvDir = getManagedUvDir();
  await platform.fs.mkdir(uvDir, { recursive: true });
  const installerPath = platform.path.join(uvDir, getUvInstallerFilename());

  const response = await http.fetchRaw(getUvInstallerUrl(version), {
    timeout: UV_INSTALL_TIMEOUT_MS,
  });
  if (!response.ok) {
    throw bootstrapError(`Failed to download uv installer (${response.status}).`);
  }

  await platform.fs.writeFile(
    installerPath,
    new Uint8Array(await response.arrayBuffer()),
  );
  if (platform.build.os !== "windows") {
    await platform.fs.chmod(installerPath, 0o755).catch(() => {});
  }

  const cmd = platform.build.os === "windows"
    ? [
      "pwsh",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      installerPath,
    ]
    : ["sh", installerPath];

  await runCommand(cmd, UV_INSTALL_TIMEOUT_MS, {
    ...platform.env.toObject(),
    UV_NO_MODIFY_PATH: "1",
    UV_UNMANAGED_INSTALL: uvDir,
  });

  await platform.fs.remove(installerPath).catch(() => {});

  const uvPath = getManagedUvBinaryPath();
  if (!await fileExists(uvPath)) {
    throw bootstrapError(
      `uv installation succeeded but ${uvPath} was not created.`,
    );
  }
  if (platform.build.os !== "windows") {
    await platform.fs.chmod(uvPath, 0o755).catch(() => {});
  }
  return uvPath;
}

async function getUvVersion(uvPath: string): Promise<string | null> {
  try {
    const stdout = await runCommand([uvPath, "--version"], 30_000);
    const match = stdout.match(/\b([0-9]+\.[0-9]+\.[0-9]+)\b/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function ensureUvBinary(version: string): Promise<string> {
  const uvPath = getManagedUvBinaryPath();
  if (await fileExists(uvPath)) {
    const actual = await getUvVersion(uvPath);
    if (actual === version) {
      return uvPath;
    }
    await getPlatform().fs.remove(uvPath).catch(() => {});
  }
  return await installUvBinary(version);
}

function parsePinnedPackages(requirements: string): PythonSidecarPackage[] {
  const packages: PythonSidecarPackage[] = [];
  for (const rawLine of requirements.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [distribution, version] = line.split("==");
    const module = SIDECAR_IMPORTS[distribution];
    if (!distribution || !version || !module) {
      throw bootstrapError(
        `Invalid managed Python requirement line: ${rawLine}`,
      );
    }
    packages.push({ distribution, version, module });
  }
  return packages;
}

async function writeManagedRequirementsFile(contents: string): Promise<string> {
  const path = getManagedPythonRequirementsPath();
  await getPlatform().fs.writeTextFile(path, normalizeRequirementsText(contents));
  return path;
}

async function getPythonVersion(pythonPath: string): Promise<string | null> {
  try {
    return await runCommand(
      [
        pythonPath,
        "-c",
        "import sys; print('.'.join(map(str, sys.version_info[:3])))",
      ],
      30_000,
    );
  } catch {
    return null;
  }
}

async function probeManagedPythonEnvironment(
  pythonPath: string,
  expectedVersion: string,
  packages: readonly PythonSidecarPackage[],
): Promise<boolean> {
  const payload = JSON.stringify(packages);
  const script = [
    "import importlib, importlib.metadata, json, sys",
    "packages = json.loads(sys.argv[1])",
    "version = '.'.join(map(str, sys.version_info[:3]))",
    "if version != sys.argv[2]:",
    "    raise SystemExit(f'python version mismatch: {version} != {sys.argv[2]}')",
    "for package in packages:",
    "    actual = importlib.metadata.version(package['distribution'])",
    "    if actual != package['version']:",
    "        raise SystemExit(",
    "            f\"{package['distribution']} version mismatch: {actual} != {package['version']}\"",
    "        )",
    "    importlib.import_module(package['module'])",
    "print('ok')",
  ].join("\n");

  try {
    const stdout = await runCommand(
      [pythonPath, "-c", script, payload, expectedVersion],
      60_000,
    );
    return stdout.trim().endsWith("ok");
  } catch (error) {
    log.debug?.(
      `Managed Python environment probe failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

async function recreateVirtualEnvironment(
  uvPath: string,
  pythonVersion: string,
  requirementsPath: string,
  packages: readonly PythonSidecarPackage[],
): Promise<string> {
  const platform = getPlatform();
  const venvDir = getManagedPythonVenvDir();
  await platform.fs.remove(venvDir, { recursive: true }).catch(() => {});

  await runCommand(
    [
      uvPath,
      "--no-config",
      "python",
      "install",
      pythonVersion,
    ],
    PYTHON_ENV_TIMEOUT_MS,
  );

  const managedPython = getManagedPythonVersionedExecutablePath(pythonVersion);
  if (!await fileExists(managedPython)) {
    throw bootstrapError(
      `uv installed Python ${pythonVersion}, but ${managedPython} was not created.`,
    );
  }

  await runCommand(
    [
      uvPath,
      "--no-config",
      "venv",
      "--python",
      managedPython,
      venvDir,
    ],
    PYTHON_ENV_TIMEOUT_MS,
  );

  const interpreterPath = getManagedPythonExecutablePath();
  if (!await fileExists(interpreterPath)) {
    throw bootstrapError(
      `uv created a virtual environment, but ${interpreterPath} is missing.`,
    );
  }

  await runCommand(
    [
      uvPath,
      "--no-config",
      "pip",
      "install",
      "--python",
      interpreterPath,
      "-r",
      requirementsPath,
    ],
    PYTHON_ENV_TIMEOUT_MS,
  );

  if (
    !await probeManagedPythonEnvironment(
      interpreterPath,
      pythonVersion,
      packages,
    )
  ) {
    throw bootstrapError(
      "Managed Python sidecar packages failed the post-install probe.",
    );
  }

  return interpreterPath;
}

async function buildPythonRecord(
  pythonVersion: string,
  uvVersion: string,
  uvPath: string,
  requirementsPath: string,
  requirementsHash: string,
  packages: readonly PythonSidecarPackage[],
): Promise<BootstrapPythonRecord> {
  const interpreterPath = getManagedPythonExecutablePath();
  return {
    runtime: "cpython",
    version: pythonVersion,
    uvVersion,
    uvPath,
    installDir: getManagedPythonInstallDir(),
    environmentPath: getManagedPythonVenvDir(),
    interpreterPath,
    hash: await hashFile(interpreterPath),
    requirementsPath,
    requirementsHash,
    packages: packages.map((pkg) => `${pkg.distribution}==${pkg.version}`),
  };
}

export async function readPinnedPythonVersion(): Promise<string> {
  return (await readEmbeddedTextFile("embedded-python-version.txt")).trim();
}

export async function readPinnedUvVersion(): Promise<string> {
  return (await readEmbeddedTextFile("embedded-uv-version.txt")).trim();
}

export async function readPinnedPythonSidecarRequirements(): Promise<string> {
  return await readEmbeddedTextFile("embedded-python-sidecar-requirements.txt");
}

async function getPinnedPythonSidecarPackages(): Promise<
  PythonSidecarPackage[]
> {
  return parsePinnedPackages(await readPinnedPythonSidecarRequirements());
}

async function resolveManagedPythonPath(): Promise<string | null> {
  const pythonPath = getManagedPythonExecutablePath();
  return await fileExists(pythonPath) ? pythonPath : null;
}

export async function ensureManagedPythonEnvironment(
  onProgress?: (message: string) => void,
): Promise<BootstrapPythonRecord> {
  await ensurePythonRuntimeDir();

  const [pythonVersion, uvVersion, requirements] = await Promise.all([
    readPinnedPythonVersion(),
    readPinnedUvVersion(),
    readPinnedPythonSidecarRequirements(),
  ]);
  const packages = parsePinnedPackages(requirements);
  const normalizedRequirements = normalizeRequirementsText(requirements);
  const requirementsHash = await hashText(normalizedRequirements);

  onProgress?.(`Installing managed uv ${uvVersion}...`);
  const uvPath = await ensureUvBinary(uvVersion);

  onProgress?.(`Preparing managed Python ${pythonVersion}...`);
  const requirementsPath = await writeManagedRequirementsFile(normalizedRequirements);
  const existingPython = await resolveManagedPythonPath();
  const existingUvVersion = await getUvVersion(uvPath);
  const existingPythonVersion = existingPython
    ? await getPythonVersion(existingPython)
    : null;
  const requirementsPathHash = await hashFile(requirementsPath).catch(() => null);

  const ready = !!(
    existingPython &&
    existingUvVersion === uvVersion &&
    existingPythonVersion === pythonVersion &&
    requirementsPathHash === requirementsHash &&
    await probeManagedPythonEnvironment(existingPython, pythonVersion, packages)
  );

  if (!ready) {
    onProgress?.("Installing default Python sidecar packages...");
    await recreateVirtualEnvironment(
      uvPath,
      pythonVersion,
      requirementsPath,
      packages,
    );
  }

  return await buildPythonRecord(
    pythonVersion,
    uvVersion,
    uvPath,
    requirementsPath,
    requirementsHash,
    packages,
  );
}

export async function verifyManagedPythonEnvironment(
  record: BootstrapPythonRecord,
): Promise<boolean> {
  const [requirements, packages] = await Promise.all([
    readPinnedPythonSidecarRequirements(),
    getPinnedPythonSidecarPackages(),
  ]);
  const expectedRequirementsHash = await hashText(
    normalizeRequirementsText(requirements),
  );

  if (
    !await fileExists(record.uvPath) ||
    !await fileExists(record.interpreterPath) ||
    !await fileExists(record.requirementsPath)
  ) {
    return false;
  }

  if (await hashFile(record.interpreterPath) !== record.hash) {
    return false;
  }
  if (await hashFile(record.requirementsPath) !== expectedRequirementsHash) {
    return false;
  }
  if (record.requirementsHash !== expectedRequirementsHash) {
    return false;
  }

  const [actualUvVersion, actualPythonVersion] = await Promise.all([
    getUvVersion(record.uvPath),
    getPythonVersion(record.interpreterPath),
  ]);
  if (actualUvVersion !== record.uvVersion || actualPythonVersion !== record.version) {
    return false;
  }

  return await probeManagedPythonEnvironment(
    record.interpreterPath,
    record.version,
    packages,
  );
}
