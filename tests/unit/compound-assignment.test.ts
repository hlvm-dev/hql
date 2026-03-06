import { assertStringIncludes } from "jsr:@std/assert";
import { transpile } from "../../src/hql/transpiler/index.ts";

Deno.test("compound assignment: arithmetic operators transpile directly", async () => {
  const result = await transpile(`
    (var x 0)
    (var base 1)
    (+= x 10)
    (-= x 5)
    (*= x 2)
    (/= x 2)
    (%= x 3)
    (**= base 2)
  `);

  assertStringIncludes(result.code, "x += 10");
  assertStringIncludes(result.code, "x -= 5");
  assertStringIncludes(result.code, "x *= 2");
  assertStringIncludes(result.code, "x /= 2");
  assertStringIncludes(result.code, "x %= 3");
  assertStringIncludes(result.code, "base **= 2");
});

Deno.test("compound assignment: bitwise operators transpile directly", async () => {
  const result = await transpile(`
    (var flags 0)
    (var mask 0)
    (var bits 0)
    (&= flags 0xFF)
    (|= flags 0x01)
    (^= mask 0xAA)
    (<<= bits 2)
    (>>= bits 1)
    (>>>= bits 1)
  `);

  assertStringIncludes(result.code, "flags &=");
  assertStringIncludes(result.code, "flags |=");
  assertStringIncludes(result.code, "mask ^=");
  assertStringIncludes(result.code, "bits <<= 2");
  assertStringIncludes(result.code, "bits >>= 1");
  assertStringIncludes(result.code, "bits >>>= 1");
});

Deno.test("compound assignment: member and index targets are preserved", async () => {
  const result = await transpile(`
    (var obj {"count": 0})
    (var arr [1 2 3])
    (+= obj.count 1)
    (*= arr.0 2)
  `);

  assertStringIncludes(result.code, "obj.count += 1");
  assertStringIncludes(result.code, "arr[0] *= 2");
});

Deno.test("compound assignment: function bodies retain multiple compound updates", async () => {
  const result = await transpile(`
    (fn updateStats [stats]
      (+= stats.total 1)
      (*= stats.multiplier 1.1)
      (-= stats.remaining 1)
      stats)
  `);

  assertStringIncludes(result.code, "stats.total += 1");
  assertStringIncludes(result.code, "stats.multiplier *= 1.1");
  assertStringIncludes(result.code, "stats.remaining -= 1");
});
