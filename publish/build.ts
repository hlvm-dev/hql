import { build, emptyDir } from "https://deno.land/x/dnt@0.37.0/mod.ts";

await emptyDir("./npm");

await build({
  entryPoints: ["./bundle.js"],
  outDir: "./npm",
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
