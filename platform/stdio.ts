// // platform/stdio.ts

// // Use globalThis to detect Deno at runtime.
// const isDeno = "Deno" in globalThis && globalThis.Deno?.version != null;

// let stdioModule: any;
// if (isDeno) {
//   stdioModule = await import("./deno/stdio.ts");
// } else {
//   // Use string concatenation to hide the Node import from static analysis.
//   const nodeModulePath = "./node/" + "stdio.ts";
//   stdioModule = await import(nodeModulePath);
// }

// export const readLineFromStdin = stdioModule.readLineFromStdin;
// export const writeToStdout = stdioModule.writeToStdout;

// platform/deno/stdio.ts
export async function readLineFromStdin(): Promise<string | null> {
    const buf = new Uint8Array(1024);
    const n = await Deno.stdin.read(buf);
    if (n === null) return null;
    return new TextDecoder().decode(buf.subarray(0, n)).replace(/\r?\n$/, "");
  }
  
  export async function writeToStdout(text: string): Promise<void> {
    await Deno.stdout.write(new TextEncoder().encode(text));
  }
  