import { build, emptyDir } from "https://deno.land/x/dnt@0.37.0/mod.ts";

await emptyDir("./npm");

await build({
  entryPoints: ["./bundle.js"],
  outDir: "./npm",
  shims: {
    deno: true,
  },
  scriptModule: false, // Distribute as an ES module to allow top-level await
  test: false,
  package: {
    name: "multiply",
    version: "1.0.0", // Hard-coded version
    description: "Boolean function that returns whether or not parameter is the number 42",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/lambtron/is-42.git",
    },
    bugs: {
      url: "https://github.com/lambtron/is-42/issues",
    },
  },  
});
