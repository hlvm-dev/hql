/**
 * Tests for LSP Find References feature
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { findReferencesInContent } from "../../../lsp/features/references.ts";

Deno.test("References - finds symbol in single file", () => {
  const content = `(fn add [a b]
  (+ a b))

(let result (add 1 2))
(print (add 3 4))`;

  const refs = findReferencesInContent(content, "add", "/test.hql");

  // Should find 3 references: definition + 2 usages
  assertEquals(refs.length, 3);

  // First reference: definition on line 0
  assertEquals(refs[0].range.start.line, 0);
  assertEquals(refs[0].range.start.character, 4); // (fn >add<

  // Second reference: first usage on line 3
  assertEquals(refs[1].range.start.line, 3);

  // Third reference: second usage on line 4
  assertEquals(refs[2].range.start.line, 4);
});

Deno.test("References - finds variable references", () => {
  const content = `(let count 0)
(= count (+ count 1))
(print count)`;

  const refs = findReferencesInContent(content, "count", "/test.hql");

  // Definition + 3 usages (= count, + count, print count)
  assertEquals(refs.length, 4);
});

Deno.test("References - does not match partial names", () => {
  const content = `(fn add [a b] (+ a b))
(fn add-numbers [x y] (add x y))
(let added (add-numbers 1 2))`;

  const refs = findReferencesInContent(content, "add", "/test.hql");

  // Should only find 2 references to "add", not "add-numbers" or "added"
  assertEquals(refs.length, 2);
});

Deno.test("References - skips references in comments", () => {
  const content = `(fn add [a b]
  ; add is a simple function
  (+ a b))

; Don't call add here
(add 1 2)`;

  const refs = findReferencesInContent(content, "add", "/test.hql");

  // Should find 2 references: definition + one call, not the ones in comments
  assertEquals(refs.length, 2);
});

Deno.test("References - skips references in strings", () => {
  const content = `(fn greet [name]
  (print "Hello, name"))

(greet "add")`;

  const refsName = findReferencesInContent(content, "name", "/test.hql");
  // Parameter definition + usage in print (but NOT in string)
  // Actually "name" appears as parameter and in "Hello, name" string
  // The string should be skipped
  assertEquals(refsName.length, 1);

  const refsAdd = findReferencesInContent(content, "add", "/test.hql");
  // "add" is only in the string, should not be found
  assertEquals(refsAdd.length, 0);
});

Deno.test("References - handles special HQL identifiers", () => {
  const content = `(fn valid? [x]
  (> x 0))

(let is-valid (valid? 5))`;

  const refs = findReferencesInContent(content, "valid?", "/test.hql");
  assertEquals(refs.length, 2);

  const refsIsValid = findReferencesInContent(content, "is-valid", "/test.hql");
  assertEquals(refsIsValid.length, 1);
});

Deno.test("References - finds class references", () => {
  const content = `(class Point
  (x y)
  (fn distance [other]
    (let dx (- (.-x other) x))
    dx))

(let p1 (new Point 0 0))
(let p2 (new Point 3 4))
(.distance p1 p2)`;

  const refs = findReferencesInContent(content, "Point", "/test.hql");
  // class definition + 2 new calls
  assertEquals(refs.length, 3);
});

Deno.test("References - finds macro references", () => {
  const content = `(macro when [test & body]
  \`(if ~test (do ~@body)))

(when true
  (print "yes"))

(when false
  (print "no"))`;

  const refs = findReferencesInContent(content, "when", "/test.hql");
  // macro definition + 2 usages
  assertEquals(refs.length, 3);
});

Deno.test("References - handles empty content", () => {
  const refs = findReferencesInContent("", "foo", "/test.hql");
  assertEquals(refs.length, 0);
});

Deno.test("References - returns correct URI", () => {
  const content = "(fn test [] 42)";
  const refs = findReferencesInContent(content, "test", "/path/to/file.hql");

  assertExists(refs[0]);
  assertEquals(refs[0].uri, "file:///path/to/file.hql");
});

Deno.test("References - handles multiline function", () => {
  const content = `(fn calculate
  [a b c]
  (+ a
     (* b c)))

(calculate 1 2 3)`;

  const refs = findReferencesInContent(content, "calculate", "/test.hql");
  assertEquals(refs.length, 2);

  // Also check parameter references
  const refsA = findReferencesInContent(content, "a", "/test.hql");
  assertEquals(refsA.length, 2); // param + usage

  const refsB = findReferencesInContent(content, "b", "/test.hql");
  assertEquals(refsB.length, 2); // param + usage
});
