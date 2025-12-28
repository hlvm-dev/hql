import { createStandardEnv, Interpreter, type InterpreterEnv } from "../src/interpreter/index.ts";
import { parse } from "../src/transpiler/pipeline/parser.ts";
import { sexpToString, isList, isLiteral, type SLiteral } from "../src/s-exp/types.ts";

// Create interpreter and env
const env = createStandardEnv();
const interp = new Interpreter({ maxCallDepth: 100, maxSeqLength: 10000 });

// Test %first on a literal
console.log("Testing %first on literals...\n");

// Parse 'false' - this gives us a literal S-expression
const falseLit = parse("false")[0];
console.log("falseLit:", JSON.stringify(falseLit, null, 2));
console.log("isLiteral(falseLit):", isLiteral(falseLit));

// Bind it as "first-clause"
env.define("first-clause", falseLit);

// Call (%first first-clause)
const code = "(%first first-clause)";
const ast = parse(code)[0];
console.log("\nCode:", code);
const result = interp.eval(ast, env);
console.log("Result:", JSON.stringify(result, null, 2));
console.log("Is result null/nil?", result === null || (isLiteral(result) && (result as SLiteral).value === null));

// Test (=== result nil)
env.define("first-el", result);
const code2 = "(=== first-el nil)";
const ast2 = parse(code2)[0];
console.log("\nCode:", code2);
const result2 = interp.eval(ast2, env);
console.log("Result:", result2);

// Test (not (=== first-el nil))
const code3 = "(not (=== first-el nil))";
const ast3 = parse(code3)[0];
console.log("\nCode:", code3);
const result3 = interp.eval(ast3, env);
console.log("Result:", result3);

// Now test the cond logic directly
console.log("\n\n=== Testing cond macro logic ===");

// Simulate cond macro with flat syntax input: (cond false 0 true 1)
const clauses = parse("(false 0 true 1)")[0];
env.define("clauses", clauses);

console.log("clauses:", sexpToString(clauses));
console.log("isList(clauses):", isList(clauses));

// first-clause = (%first clauses)
const firstClauseCode = "(%first clauses)";
const firstClauseResult = interp.eval(parse(firstClauseCode)[0], env);
console.log("\nfirst-clause = (%first clauses):", JSON.stringify(firstClauseResult, null, 2));
console.log("sexpToString:", sexpToString(firstClauseResult));

// first-el = (%first first-clause)
env.define("first-clause", firstClauseResult);
const firstElCode = "(%first first-clause)";
const firstElResult = interp.eval(parse(firstElCode)[0], env);
console.log("\nfirst-el = (%first first-clause):", JSON.stringify(firstElResult, null, 2));
console.log("sexpToString:", sexpToString(firstElResult));

// (=== first-el nil)
env.define("first-el", firstElResult);
const isNilCode = "(=== first-el nil)";
const isNilResult = interp.eval(parse(isNilCode)[0], env);
console.log("\n(=== first-el nil):", isNilResult);

// (not (=== first-el nil))
const notNilCode = "(not (=== first-el nil))";
const notNilResult = interp.eval(parse(notNilCode)[0], env);
console.log("(not (=== first-el nil)):", notNilResult);
