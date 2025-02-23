// modules/publish/publish_common.ts

import { join, readTextFile, writeTextFile, runCmd, getEnv } from "../../platform/platform.ts";
import { exists } from "jsr:@std/fs@1.0.13";

/**
 * Returns the next version string for the given directory.
 * If a version is provided, that version is written to the VERSION file and returned.
 * Otherwise, if no VERSION file exists, it creates one with "0.0.1".
 * If the file exists, it bumps the patch number.
 */
export async function getNextVersionInDir(
  outDir: string,
  provided?: string,
): Promise<string> {
  const versionFile = join(outDir, "VERSION");
  if (provided) {
    await writeTextFile(versionFile, provided);
    console.log(`Forcing version to ${provided} in ${outDir}`);
    return provided;
  }
  if (!(await exists(versionFile))) {
    const defaultVersion = "0.0.1";
    await writeTextFile(versionFile, defaultVersion);
    console.log(`No VERSION file found in ${outDir}. Setting version to ${defaultVersion}`);
    return defaultVersion;
  }
  const current = (await readTextFile(versionFile)).trim();
  const parts = current.split(".");
  if (parts.length !== 3) {
    throw new Error(`Invalid version format in ${versionFile}: "${current}"`);
  }
  const [major, minor] = parts;
  let patch = parseInt(parts[2], 10);
  patch++;
  const newVersion = `${major}.${minor}.${patch}`;
  await writeTextFile(versionFile, newVersion);
  console.log(`Bumped version from ${current} to ${newVersion} in ${outDir}`);
  return newVersion;
}

/**
 * Auto-detects the npm username.
 * First, checks the NPM_USERNAME environment variable;
 * if not set, runs "npm whoami".
 */
export async function getNpmUsername(): Promise<string | undefined> {
  let npmUser = getEnv("NPM_USERNAME");
  if (npmUser) return npmUser.trim();
  try {
    const proc = runCmd({
      cmd: ["npm", "whoami"],
      stdout: "piped",
      stderr: "null",
    });
    const output = await proc.output();
    proc.close();
    npmUser = new TextDecoder().decode(output).trim();
    return npmUser || undefined;
  } catch (e) {
    console.error("Failed to auto-detect npm username:", e);
    return undefined;
  }
}
