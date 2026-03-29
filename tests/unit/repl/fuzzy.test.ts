import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  compareScoredFuzzyMatches,
  fuzzyFilter,
  fuzzyMatch,
  fuzzyMatchPath,
} from "../../../src/hlvm/cli/repl/fuzzy.ts";

Deno.test("fuzzy matcher: exact match beats a loose fuzzy match", () => {
  const exact = fuzzyMatch("map", "map", "symbol");
  const loose = fuzzyMatch("map", "megaAlphaProcessor", "symbol");

  assert(exact !== null);
  assert(loose !== null);
  assert(exact.score > loose.score);
});

Deno.test("fuzzy matcher: boundary, camelCase, and consecutive matches rank higher", () => {
  const camel = fuzzyMatch("fb", "fooBar", "symbol");
  const plain = fuzzyMatch("fb", "foobar", "symbol");
  const contiguous = fuzzyMatch("map", "mapIndexed", "symbol");
  const scattered = fuzzyMatch("map", "megaAlphaProcessor", "symbol");

  assert(camel !== null);
  assert(plain !== null);
  assert(contiguous !== null);
  assert(scattered !== null);

  assert(camel.score > plain.score);
  assert(contiguous.score > scattered.score);
});

Deno.test("fuzzy matcher: basename-heavy path matches outrank directory-only matches", () => {
  const basename = fuzzyMatchPath("spec", "docs/api/spec.md");
  const directory = fuzzyMatchPath("spec", "spec/docs/api.md");

  assert(basename !== null);
  assert(directory !== null);
  assert(basename.score > directory.score);
});

Deno.test("fuzzy matcher: tie-breaking stays deterministic for equal scores", () => {
  assert(compareScoredFuzzyMatches("alpha", 100, [1, 2], "alphabet", 100, [1, 2]) < 0);
  assert(compareScoredFuzzyMatches("alphabet", 100, [1, 2], "alpha", 100, [1, 2]) > 0);
});

Deno.test("fuzzy filter: auto-threshold keeps the stronger path-style hits first", () => {
  const results = fuzzyFilter(
    [
      { value: "docs/api/spec.md" },
      { value: "spec/docs/api.md" },
      { value: "notes/archive.txt" },
    ],
    "spec",
    (item) => item.value,
    { preset: "path", minScore: "auto" },
  );

  assertEquals(results[0]?.matchResult.indices.length > 0, true);
  assertEquals(results[0]?.matchResult.score >= results[1]?.matchResult.score, true);
  assertEquals(results[0]?.value, "docs/api/spec.md");
});
