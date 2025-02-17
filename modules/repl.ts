// repl.ts
import { parse } from "./parser.ts";
import { evaluateAsync } from "./eval.ts";
import { Env } from "./env.ts";
import { HQLValue, makeNil } from "./type.ts";
import { formatValue } from "./stdlib.ts";

async function readLine(): Promise<string | null> {
  const buf = new Uint8Array(1024);
  const n = await Deno.stdin.read(buf);
  if (n === null) return null;
  return new TextDecoder().decode(buf.subarray(0, n)).replace(/\r?\n$/, "");
}

function countParens(input: string): number {
  let c = 0, str = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i);
    if (ch === '"' && (i === 0 || input.charAt(i - 1) !== "\\")) {
      str = !str;
    }
    if (!str) {
      if (ch === "(") c++;
      else if (ch === ")") c--;
    }
  }
  return c;
}

async function readMultiline(): Promise<string | null> {
  let code = "";
  let pc = 0;
  while (true) {
    const prompt = pc > 0 ? "...> " : "HQL> ";
    await Deno.stdout.write(new TextEncoder().encode(prompt));
    const line = await readLine();
    if (line === null) return code.trim() === "" ? null : code;
    code += line + "\n";
    pc = countParens(code);
    if (pc <= 0) break;
  }
  return code;
}

export async function repl(env: Env) {
  while (true) {
    const hql = await readMultiline();
    if (hql === null) {
      console.log("\nGoodbye.");
      return;
    }
    if (!hql.trim()) continue;
    if (hql.trim() === "(exit)") {
      console.log("Goodbye.");
      return;
    }
    try {
      const forms = parse(hql);
      let result: HQLValue = makeNil();
      for (const f of forms) {
        result = await evaluateAsync(f, env);
      }
      console.log(formatValue(result));
    } catch (e: any) {
      console.error("Error:", e.message);
    }
  }
}
