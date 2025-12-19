import hql from "./mod.ts";

const code = `(let nums (iterate (fn [x] (+ x 1)) 0))`;

console.log("Transpiling...");
const result = await hql.transpile(code, {
  generateSourceMap: false,
});
console.log("Result:");
console.log(result);
