// platform/platform.ts

const isDeno = "Deno" in globalThis && globalThis.Deno?.version != null;

let platformModule: any;
if (isDeno) {
  platformModule = await import("./deno/platform.ts");
} else {
  const nodeModulePath = "./node/" + "platform.ts";
  platformModule = await import(nodeModulePath);
}

export const cwd = platformModule.cwd;
export const stat = platformModule.stat;
export const readTextFile = platformModule.readTextFile;
export const writeTextFile = platformModule.writeTextFile;
export const mkdir = platformModule.mkdir;
export const join = platformModule.join;
export const dirname = platformModule.dirname;
export const basename = platformModule.basename;
export const extname = platformModule.extname;
export const isAbsolute = platformModule.isAbsolute;
export const resolve = platformModule.resolve;
export const relative = platformModule.relative;
export const realPathSync = platformModule.realPathSync;
export const execPath = platformModule.execPath;
export const run = platformModule.run;
