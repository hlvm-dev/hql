// modules/publish/publish.ts

import { parse } from "https://deno.land/std@0.170.0/flags/mod.ts";
import { basename, cwd, exit } from "../../platform/platform.ts";
import { publishNpm } from "./publish_npm.ts";
import { publishJSR } from "./publish_jsr.ts";

export interface PublishOptions {
  platform: "jsr" | "npm";
  what: string;
  name?: string;
  version?: string;
}

// Normalize one-dash flags to two-dash.
function normalizeArgs(args: string[]): string[] {
  const allowed = new Set(["what", "name", "version", "where"]);
  return args.map(arg => {
    if (arg.startsWith("-") && !arg.startsWith("--")) {
      const key = arg.slice(1);
      if (allowed.has(key)) {
        return `--${key}`;
      }
    }
    return arg;
  });
}

/**
 * Parses publish arguments.
 *
 * For JSR:
 *    If the positional parameters are ["jsr", <targetDir>] then package name is undefined
 *    and will default to `@boraseoksoon/<basename(targetDir)>`.
 *    If they are ["jsr", <targetDir>, <packageName>], then <packageName> is used.
 *
 * For npm, similar logic applies.
 */
function parsePublishArgs(args: string[]): PublishOptions {
  const normalizedArgs = normalizeArgs(args);
  const parsed = parse(normalizedArgs, {
    string: ["what", "name", "version", "where"],
  });

  // Validate unknown flags.
  const allowedFlags = new Set(["what", "name", "version", "where", "_"]);
  for (const key of Object.keys(parsed)) {
    if (!allowedFlags.has(key)) {
      console.error(`Unknown flag: --${key}. Allowed flags: -what, -name, -version, -where.`);
      exit(1);
    }
  }

  if (parsed.version && !/^\d+\.\d+\.\d+$/.test(parsed.version)) {
    console.error(`Invalid version format: ${parsed.version}. Expected format: X.Y.Z`);
    exit(1);
  }

  let platform: "jsr" | "npm" = "jsr";
  if (parsed.where) {
    const whereVal = String(parsed.where).toLowerCase();
    if (whereVal === "npm" || whereVal === "jsr") {
      platform = whereVal as "jsr" | "npm";
    } else {
      console.error("Invalid value for -where flag. Must be 'npm' or 'jsr'.");
      exit(1);
    }
  }
  const pos = parsed._;
  let what = pos.length > 0 ? String(pos[0]) : cwd();
  // If the first positional argument is a platform flag, adjust accordingly.
  if (pos.length > 0 && ["npm", "jsr"].includes(String(pos[0]).toLowerCase())) {
    platform = String(pos[0]).toLowerCase() as "jsr" | "npm";
    what = pos.length > 1 ? String(pos[1]) : cwd();
  }
  if (parsed.what) {
    what = String(parsed.what);
  }
  if (!what) {
    what = cwd();
  }

  let name: string | undefined;
  if (parsed.name) {
    name = String(parsed.name);
  } else {
    if (platform === "jsr") {
      // Only use a positional package name if explicitly provided as the third parameter.
      if (pos.length >= 3) {
        name = String(pos[2]);
      }
      if (!name) {
        name = `@boraseoksoon/${basename(what)}`;
      }
    } else if (platform === "npm") {
      if (pos.length >= 3 && !["npm", "jsr"].includes(String(pos[0]).toLowerCase())) {
        name = String(pos[2]);
      } else if (pos.length >= 4) {
        name = String(pos[3]);
      }
    }
  }

  let version: string | undefined;
  if (parsed.version) {
    version = String(parsed.version);
  } else {
    if (platform === "jsr") {
      if (pos.length >= 4) {
        version = String(pos[3]);
      }
    } else if (platform === "npm") {
      if (pos.length >= 3 && !["npm", "jsr"].includes(String(pos[0]).toLowerCase())) {
        version = String(pos[3]);
      } else if (pos.length >= 4) {
        version = String(pos[4]);
      }
    }
  }
  return { platform, what, name, version };
}

/**
 * Main publish mediator.
 */
export async function publish(args: string[]): Promise<void> {
  const options = parsePublishArgs(args);
  if (options.platform === "npm") {
    console.log(`Publishing npm package with:
  Directory: ${options.what}
  Package Name: ${options.name ?? "(auto-generated)"}
  Version: ${options.version ?? "(auto-incremented)"}`);
    await publishNpm({ what: options.what, name: options.name, version: options.version });
  } else {
    console.log(`Publishing JSR package with:
  Directory: ${options.what}
  Package Name: ${options.name ?? "(auto-generated)"}
  Version: ${options.version ?? "(auto-incremented)"}`);
    await publishJSR({ what: options.what, name: options.name, version: options.version });
  }
}
