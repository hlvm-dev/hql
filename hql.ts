import { runHQLFile, transpileHQLFile } from "./transpiler.ts";
import { repl } from "./repl.ts";
import { Env, baseEnv } from "./env.ts";

if (import.meta.main) {
  const args = Deno.args;
  if (args[0] === "--transpile") {
    if (args.length < 2) {
      console.error("Missing HQL file in transpile mode.");
      Deno.exit(1);
    }
    const inputFile = args[1];
    const outFile = args[2] || undefined;
    await transpileHQLFile(inputFile, outFile);
  } else if (args.length > 0) {
    const file = args[0];
    await runHQLFile(file);
  } else {
    console.log("Welcome to HQL. Type (exit) or Ctrl+C to quit.");
    await repl(new Env({}, baseEnv));
  }
}

export { runHQLFile, transpileHQLFile };
