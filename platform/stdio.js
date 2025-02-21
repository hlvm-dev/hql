// platform/stdio.ts
// Use globalThis to detect Deno at runtime.
const isDeno = "Deno" in globalThis && globalThis.Deno?.version != null;
let stdioModule;
if (isDeno) {
    stdioModule = await import("./deno/stdio.ts");
}
else {
    // Use string concatenation to hide the Node import from static analysis.
    const nodeModulePath = "./node/" + "stdio.ts";
    stdioModule = await import(nodeModulePath);
}
export const readLineFromStdin = stdioModule.readLineFromStdin;
export const writeToStdout = stdioModule.writeToStdout;
