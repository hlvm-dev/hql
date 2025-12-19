// Simple transpile test
import hql from "./mod.ts";

const source = `
(let nums (iterate (fn [x] (+ x 1)) 0))
(first nums)
`;

console.log("Calling hql.transpile...");
const result = await hql.transpile(source);
console.log("Result:", result);
