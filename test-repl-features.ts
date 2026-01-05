import { highlight, findMatchingParen } from "./src/cli/repl/syntax.ts";
import { findSuggestion } from "./src/cli/repl/suggester.ts";
import { getCompletions } from "./src/cli/repl/completer.ts";

console.log("--- Highlighting Fact Check ---");
const h = highlight("(defn add [x] (+ x 1))");
const hasAnsi = h.includes("\x1b[");
console.log(`Highlighter produced ANSI codes: ${hasAnsi}`);

console.log("\n--- Paren Matching Fact Check ---");
const input = "(+ 1 2)";
// Cursor at index 6 (on the closing paren)
const matchIndex = findMatchingParen(input, 6);
console.log(`Matching paren index for ')' at 6: ${matchIndex} (Expected: 0)`);

if (matchIndex === 0) {
  // Now test highlighting with this match
  const hMatch = highlight(input, matchIndex);
  // Implementation uses BOLD + CYAN concatenation: \x1b[1m\x1b[36m
  const hasBoldCyan = hMatch.includes("\x1b[1m\x1b[36m(");
  console.log(`Paren matching highlight found (Bold Cyan on '('): ${hasBoldCyan}`);
} else {
  console.log("FAILED: Paren matching index incorrect.");
}

console.log("\n--- Suggester Fact Check ---");
const history = ["(defn calculate [a b] (+ a b))"];
const suggestion = findSuggestion("(defn", history);
if (suggestion) {
    console.log(`Suggestion found: "${suggestion.full}"`);
    console.log(`Matches history item: ${suggestion.full === history[0]}`);
    console.log(`Ghost text: "${suggestion.ghost}"`);
} else {
    console.log("FAILED: No suggestion found.");
}

console.log("\n--- Completer Fact Check ---");
const known = new Set(["defn", "def", "map", "filter"]);
// Correct signature: (prefix, userBindings). Prefix should be the word "def", not "(def"
const comps = getCompletions("def", known);
console.log(`Completions found: ${comps.length}`);
const texts = comps.map(c => c.text);
console.log(`Completions for 'def': ${JSON.stringify(texts)}`);
const hasDefn = texts.includes("defn");
console.log(`Includes 'defn': ${hasDefn}`);