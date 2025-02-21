// platform/path.ts

const isDeno = "Deno" in globalThis && globalThis.Deno?.version != null;

let pathModule: any;
if (isDeno) {
  pathModule = await import("./deno/path.ts");
} else {
  const nodeModulePath = "./node/" + "path.ts";
  pathModule = await import(nodeModulePath);
}

export const { dirname, join, resolve } = pathModule;
