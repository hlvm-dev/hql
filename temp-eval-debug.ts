// Debug test - simulate running transpiled HQL code
import hql from "./mod.ts";

const code = `(let nums (iterate (fn [x] (+ x 1)) 0))`;

console.log("Transpiling...");
const result = await hql.transpile(code, {
  generateSourceMap: false,
});
console.log("Transpiled code:");
console.log(result);

console.log("\nNow running the transpiled code manually...");

// Initialize runtime
import { initializeRuntimeHelpers } from "./src/common/runtime-helpers.ts";
initializeRuntimeHelpers();

// Run the transpiled code using eval
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const evaluate = new AsyncFunction("source", "return eval(source);");

console.log("Evaluating...");
const evalResult = await evaluate(result as string);
console.log("Eval result:", evalResult);
