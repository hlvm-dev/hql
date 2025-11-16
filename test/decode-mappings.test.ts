/**
 * Decode source map mappings to see what's wrong
 */

import hql from "../mod.ts";
import { SourceMapConsumer } from "npm:source-map@0.6.1";

Deno.test("Decode actual source map mappings", async () => {
  const code = `(let data [1 2 3])
(let result (map (fn (x) (* x 2)) data))
(let bad (/ 10 undefined_var))`;

  console.log("=== HQL CODE (3 lines) ===");
  code.split('\n').forEach((line, i) => {
    console.log(`HQL Line ${i + 1}: ${line}`);
  });
  console.log();

  const result = await hql.transpile(code, {
    generateSourceMap: true,
    currentFile: "/tmp/test.hql",
    sourceContent: code
  });

  const sourceMap = typeof result === 'string' ? null : result.sourceMap;

  if (!sourceMap) {
    throw new Error("No source map generated");
  }

  const map = JSON.parse(sourceMap);
  const consumer = await new SourceMapConsumer(map);

  console.log("=== WHAT DOES JS LINE 11 MAP TO? ===");

  // Check multiple columns on line 11
  for (const col of [0, 50, 100, 108, 150]) {
    const mapped = consumer.originalPositionFor({
      line: 11,
      column: col
    });
    console.log(`JS Line 11, Col ${col} → HQL Line ${mapped.line}, Col ${mapped.column}`);
  }

  console.log();
  console.log("=== CHECK ALL JS LINES ===");

  for (let jsLine = 1; jsLine <= 12; jsLine++) {
    const mapped = consumer.originalPositionFor({
      line: jsLine,
      column: 0
    });

    if (mapped.line !== null) {
      console.log(`JS Line ${String(jsLine).padStart(2, ' ')} → HQL Line ${mapped.line}`);
    } else {
      console.log(`JS Line ${String(jsLine).padStart(2, ' ')} → [NO MAPPING]`);
    }
  }
});
