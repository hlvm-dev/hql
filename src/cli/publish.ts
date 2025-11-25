#!/usr/bin/env -S deno run -A
// cli/publish.ts - CLI utility for publishing HQL modules

import { publish } from "./publish/index.ts";
import { parseArgs } from "jsr:@std/cli@1.0.13/parse-args";
import {
  exit as platformExit,
  getArgs as platformGetArgs,
  getEnv as platformGetEnv,
  setEnv as platformSetEnv,
} from "../platform/platform.ts";

function showHelp() {
  console.log(`
HQL Publish Tool - Publish HQL modules to NPM or JSR

USAGE:
  publish [options] <what> [platform] [name] [version]

PLATFORMS:
  jsr     Publish to JSR (default)
  npm     Publish to NPM

OPTIONS:
  -what, -w      Directory or HQL file to publish (defaults to current directory)
  -name, -n      Package name (defaults to auto-generated)
  -version, -v   Package version (defaults to auto-increment)
  -where         Target platform: 'npm' or 'jsr' (defaults to 'jsr')
  -verbose       Enable verbose logging
  -help, -h      Show this help message

EXAMPLES:
  publish ./my-module
  publish ./my-module npm
  publish ./my-module jsr my-awesome-package 1.2.3
  publish ./my-module -where=jsr -name=my-awesome-package -version=1.2.3
`);
}

async function main() {
  const args = platformGetArgs();
  const parsedArgs = parseArgs(args, {
    boolean: ["help", "verbose"],
    string: ["what", "name", "version", "where"],
    alias: { h: "help", w: "what", n: "name", v: "version" },
  });
  if (parsedArgs.help) {
    showHelp();
    platformExit(0);
  }
  console.log("\n✨ HQL Publish Tool ✨\n");
  if (platformGetEnv("HQL_DEV") === "1") {
    platformSetEnv("SKIP_LOGIN_CHECK", "1");
  }

  await publish(args);
}

if (import.meta.main) {
  main();
}
