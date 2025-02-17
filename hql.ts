#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env
/**
 * HQL: Higher level Query Language
 * Usage:
 *   deno run --allow-read --allow-write --allow-net --allow-env hql.ts file.hql
 *   deno run --allow-read --allow-write --allow-net --allow-env hql.ts --transpile file.hql
 */

import { runHQLFile, transpile } from "./modules/compiler/transpiler.ts";
import { repl } from "./modules/repl.ts";
import { Env, baseEnv } from "./modules/env.ts";

if (import.meta.main) {
  if (Deno.args[0] === "--transpile") {
    if (Deno.args.length < 2) {
      console.error("Missing HQL file in transpile mode.");
      Deno.exit(1);
    }
    const inputFile = Deno.args[1];
    const outFile = Deno.args[2] || undefined;
    await transpile(inputFile, outFile);
  } else if (Deno.args.length > 0) {
    const file = Deno.args[0];
    await runHQLFile(file);
  } else {
    console.log("Welcome to HQL. Type (exit) or Ctrl+C to quit.");
    await repl(new Env({}, baseEnv));
  }
}

export { runHQLFile }
export { getExport } from "./modules/exports.ts";
