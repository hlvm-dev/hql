import { build, emptyDir } from "https://deno.land/x/dnt@0.37.0/mod.ts";

await emptyDir("./npm");

await build({
  entryPoints: ["./bundle.js"],
  outDir: "./npm",
  // By default, dnt emits the final ESM package into npm/esm.
  // We leave that as is—your jsr.json will reference "./esm/bundle.js".
  shims: {
    deno: true,
  },
  scriptModule: false,
  test: false,
  package: {
    name: "",
    version: "0.0.0"
  },
});