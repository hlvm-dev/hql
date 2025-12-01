import { transpile } from "../../mod.ts";

/**
 * Comprehensive dot notation audit
 * Tests EXACTLY what works and what doesn't
 */

async function testCase(name: string, hql: string): Promise<{ name: string; hql: string; js?: string; error?: string }> {
  try {
    const result = await transpile(hql);
    const js = typeof result === 'string' ? result : result.code;
    return { name, hql, js };
  } catch (error) {
    return { name, hql, error: error instanceof Error ? error.message : String(error) };
  }
}

Deno.test("Dot Notation Audit - Group 1: Simple Property Access", async () => {
  const results = await Promise.all([
    testCase("1. arr.length (bare)", "arr.length"),
    testCase("2. (arr.length) (in parentheses)", "(arr.length)"),
    testCase("3. obj.name.length (chained, bare)", "obj.name.length"),
    testCase("4. (obj.name.length) (chained, in parens)", "(obj.name.length)"),
  ]);
});

Deno.test("Dot Notation Audit - Group 2: Single Method Call", async () => {
  const results = await Promise.all([
    testCase("5. (arr.push 42) (spaceless)", "(arr.push 42)"),
    testCase("6. (arr .push 42) (spaced)", "(arr .push 42)"),
    testCase("7. (str.toUpperCase) (spaceless, no args)", "(str.toUpperCase)"),
    testCase("8. (str .toUpperCase) (spaced, no args)", "(str .toUpperCase)"),
  ]);
});

Deno.test("Dot Notation Audit - Group 3: Method Chaining - Spaced", async () => {
  const results = await Promise.all([
    testCase("9. (text .trim .toUpperCase) (spaced chain)", "(text .trim .toUpperCase)"),
    testCase("10. (arr .map fn .filter pred) (spaced chain with args)", "(arr .map fn .filter pred)"),
    testCase("11. (arr .push 1 .push 2 .push 3) (spaced chain, multiple args)", "(arr .push 1 .push 2 .push 3)"),
  ]);
});

Deno.test("Dot Notation Audit - Group 4: Method Chaining - Spaceless", async () => {
  const results = await Promise.all([
    testCase("12. (text.trim.toUpperCase) (spaceless chain, no args)", "(text.trim.toUpperCase)"),
    testCase("13. (arr.map fn.filter pred) (spaceless chain with args)", "(arr.map fn.filter pred)"),
    testCase("14. (arr.push.map.filter) (spaceless chain, no args)", "(arr.push.map.filter)"),
  ]);
});

Deno.test("Dot Notation Audit - Group 5: Edge Cases", async () => {
  const results = await Promise.all([
    testCase("15. (arr.push 42.toString) (method then chain on result)", "(arr.push 42.toString)"),
    testCase("16. 42.5 (numeric literal with decimal)", "42.5"),
    testCase("17. Math.PI (bare module property)", "Math.PI"),
    testCase("18. (Math.PI) (module property in parens)", "(Math.PI)"),
  ]);
});

// Summary test that creates a table
Deno.test("Dot Notation Audit - Summary Table", async () => {
  const allTests = await Promise.all([
    // Group 1
    testCase("1. arr.length (bare)", "arr.length"),
    testCase("2. (arr.length) (in parentheses)", "(arr.length)"),
    testCase("3. obj.name.length (chained, bare)", "obj.name.length"),
    testCase("4. (obj.name.length) (chained, in parens)", "(obj.name.length)"),
    // Group 2
    testCase("5. (arr.push 42) (spaceless)", "(arr.push 42)"),
    testCase("6. (arr .push 42) (spaced)", "(arr .push 42)"),
    testCase("7. (str.toUpperCase) (spaceless, no args)", "(str.toUpperCase)"),
    testCase("8. (str .toUpperCase) (spaced, no args)", "(str .toUpperCase)"),
    // Group 3
    testCase("9. (text .trim .toUpperCase) (spaced chain)", "(text .trim .toUpperCase)"),
    testCase("10. (arr .map fn .filter pred) (spaced chain with args)", "(arr .map fn .filter pred)"),
    testCase("11. (arr .push 1 .push 2 .push 3) (spaced chain, multiple args)", "(arr .push 1 .push 2 .push 3)"),
    // Group 4
    testCase("12. (text.trim.toUpperCase) (spaceless chain, no args)", "(text.trim.toUpperCase)"),
    testCase("13. (arr.map fn.filter pred) (spaceless chain with args)", "(arr.map fn.filter pred)"),
    testCase("14. (arr.push.map.filter) (spaceless chain, no args)", "(arr.push.map.filter)"),
    // Group 5
    testCase("15. (arr.push 42.toString) (method then chain on result)", "(arr.push 42.toString)"),
    testCase("16. 42.5 (numeric literal with decimal)", "42.5"),
    testCase("17. Math.PI (bare module property)", "Math.PI"),
    testCase("18. (Math.PI) (module property in parens)", "(Math.PI)"),
  ]);

  
  allTests.forEach(r => {
    if (r.js) {
    } else {
    }
  });
});
