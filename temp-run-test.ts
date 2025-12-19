import hql from "./mod.ts";

const code = `(let nums (iterate (fn [x] (+ x 1)) 0))`;

console.log("Running...");
try {
  const result = await hql.run(code, {
    generateSourceMap: false,
  });
  console.log("Result:", result);
} catch (e) {
  console.error("Error:", e);
}
