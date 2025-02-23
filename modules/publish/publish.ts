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

// Normalize one-dash long flags (e.g. "-version") into two-dash flags.
function normalizeArgs(args: string[]): string[] {
  const allowed = new Set(["what", "name", "version", "where"]);
  return args.map((arg) => {
    // If the argument starts with a single dash and its remainder matches one of our flag names,
    // prepend an extra dash.
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
 * Parses publish arguments from positional parameters and named flags.
 * Supported flags: -what, -name, -version, -where.
 * Also performs validation on unknown flags and flag formats.
 */
function parsePublishArgs(args: string[]): PublishOptions {
  const normalizedArgs = normalizeArgs(args);
  const parsed = parse(normalizedArgs, {
    string: ["what", "name", "version", "where"],
  });

  // Check for unknown flags.
  const allowedFlags = new Set(["what", "name", "version", "where", "_"]);
  for (const key of Object.keys(parsed)) {
    if (!allowedFlags.has(key)) {
      console.error(`Unknown flag: --${key}. Allowed flags are: -what, -name, -version, -where.`);
      exit(1);
    }
  }

  // Validate version format if provided.
  if (parsed.version && !/^\d+\.\d+\.\d+$/.test(parsed.version)) {
    console.error(`Invalid version format: ${parsed.version}. Expected format: X.Y.Z (e.g. 1.0.0).`);
    exit(1);
  }

  let platform: "jsr" | "npm" = "jsr";
  if (parsed.where) {
    const whereVal = String(parsed.where).toLowerCase();
    if (whereVal === "npm" || whereVal === "jsr") {
      platform = whereVal as "jsr" | "npm";
    } else {
      console.error("Invalid value for -where flag. Must be either 'npm' or 'jsr'.");
      exit(1);
    }
  }
  const pos = parsed._;
  let what = pos.length > 0 ? String(pos[0]) : cwd();
  if (pos.length > 0 && ["npm", "jsr"].includes(String(pos[0]).toLowerCase())) {
    platform = String(pos[0]).toLowerCase() as "npm" | "jsr";
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
      if (pos.length >= 2) {
        name = String(pos[1]);
      }
      if (!name) {
        name = `@boraseoksoon/${basename(what)}`;
      }
    } else if (platform === "npm") {
      if (pos.length >= 2 && !["npm", "jsr"].includes(String(pos[0]).toLowerCase())) {
        name = String(pos[1]);
      } else if (pos.length >= 3) {
        name = String(pos[2]);
      }
    }
  }

  let version: string | undefined;
  if (parsed.version) {
    version = String(parsed.version);
  } else {
    if (platform === "jsr") {
      if (pos.length >= 3) {
        version = String(pos[2]);
      }
    } else if (platform === "npm") {
      if (pos.length >= 3 && !["npm", "jsr"].includes(String(pos[0]).toLowerCase())) {
        version = String(pos[2]);
      } else if (pos.length >= 4) {
        version = String(pos[3]);
      }
    }
  }
  return { platform, what, name, version };
}

/**
 * Mediator for publishing an HQL module.
 * This function hides all internal details. The caller only needs to
 * call publish(args) (where args are the CLI parameters for publish),
 * and this module dispatches the task to either publishNpm or publishJSR.
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
  Package Name: ${options.name}
  Version: ${options.version ?? "(auto-incremented)"}`);
    await publishJSR({ what: options.what, name: options.name, version: options.version });
  }
}
