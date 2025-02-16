#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env
/**
 * HQL Interpreter (Production)
 *
 * Features:
 *  - Single–pass parser with minimal allocations.
 *  - Separate async and sync evaluation paths.
 *  - Functions (declared via defn or defx) now support both positional and fully labeled calls.
 *    In a labeled call, label names are ignored and arguments are bound by position.
 *    (Mixed labeled and positional arguments are still rejected.)
 *  - In transpile mode, typed functions are always exported as async.
 *
 * Usage:
 *   deno run --allow-read --allow-write --allow-net --allow-env hql.ts file.hql
 *   deno run --allow-read --allow-write --allow-net --allow-env hql.ts --transpile file.hql
 */

import { runHQLFile, transpileHQLFile } from "./transpiler.ts";
import { getExport } from "./exports.ts";
import { repl } from "./repl.ts";
import { Env, baseEnv } from "./env.ts";

if (import.meta.main) {
  if (Deno.args[0] === "--transpile") {
    if (Deno.args.length < 2) {
      console.error("Missing HQL file in transpile mode.");
      Deno.exit(1);
    }
    const inputFile = Deno.args[1];
    const outFile = Deno.args[2] || undefined;
    await transpileHQLFile(inputFile, outFile);
  } else if (Deno.args.length > 0) {
    const file = Deno.args[0];
    await runHQLFile(file);
  } else {
    console.log("Welcome to HQL. Type (exit) or Ctrl+C to quit.");
    await repl(new Env({}, baseEnv));
  }
}

export { runHQLFile, transpileHQLFile, getExport };
