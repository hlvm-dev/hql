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

/**
 * Parses publish arguments from positional parameters and named flags.
 * Supported flags: -what, -name, -version, -where.
 */
function parsePublishArgs(args: string[]): PublishOptions {
  const parsed = parse(args, {
    string: ["what", "name", "version", "where"],
  });
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
