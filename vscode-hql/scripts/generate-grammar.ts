#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * Generate tmLanguage.json from HQL's single source of truth.
 *
 * ALL patterns are derived from:
 * - src/transpiler/keyword/primitives.ts
 * - src/common/known-identifiers.ts
 *
 * NO HARDCODING - everything comes from the source of truth.
 *
 * Usage:
 *   deno run --allow-read --allow-write vscode-hql/scripts/generate-grammar.ts
 */

import {
  KERNEL_PRIMITIVES,
  ALL_OPERATOR_NAMES,
  ALL_CONSTANT_KEYWORDS,
  JS_LITERAL_KEYWORDS,
  DECLARATION_KEYWORDS,
  BINDING_KEYWORDS,
  ARITHMETIC_OPS,
  COMPARISON_OPS,
  LOGICAL_OPS,
  BITWISE_OPS,
} from "../../src/transpiler/keyword/primitives.ts";

import {
  getAllKnownIdentifiers,
  initializeIdentifiers,
  CONTROL_FLOW_KEYWORDS,
  THREADING_MACROS,
  DECLARATION_SPECIAL_FORMS,
  MODULE_SYNTAX_KEYWORDS,
  JS_GLOBAL_NAMES,
  WORD_LOGICAL_OPERATORS,
  extractMacroNames,
} from "../../src/common/known-identifiers.ts";

/**
 * Escape special regex characters for TextMate patterns.
 */
function escapeForRegex(str: string): string {
  // Single backslash escape - JSON.stringify will add the second
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build control flow keyword pattern from CONTROL_FLOW_KEYWORDS.
 */
function buildControlKeywordPattern(): string {
  return [...CONTROL_FLOW_KEYWORDS].join("|");
}

/**
 * Build declaration keyword pattern from source of truth exports.
 * NO HARDCODING - uses DECLARATION_SPECIAL_FORMS and MODULE_SYNTAX_KEYWORDS.
 */
function buildDeclarationPattern(): string {
  const declarations = new Set([
    ...BINDING_KEYWORDS,           // let, var, const, def
    ...DECLARATION_KEYWORDS,       // fn, function, class, enum
    ...DECLARATION_SPECIAL_FORMS,  // macro, import, export, new
    ...MODULE_SYNTAX_KEYWORDS,     // from, as, field
  ]);
  return [...declarations].filter(d => !d.includes("/")).join("|");
}

/**
 * Build logical word operators (and, or, not) from WORD_LOGICAL_OPERATORS.
 */
function buildLogicalWordPattern(): string {
  return [...WORD_LOGICAL_OPERATORS].join("|");
}

/**
 * Build operator patterns from source of truth in primitives.ts.
 * NO HARDCODING - uses ARITHMETIC_OPS, COMPARISON_OPS, LOGICAL_OPS, BITWISE_OPS.
 */
function buildOperatorPatterns(): {
  arithmetic: string;
  comparison: string;
  logical: string;
  bitwise: string;
} {
  // Build regex patterns with proper escaping
  const escapeOp = (o: string) => escapeForRegex(o);

  return {
    // Sort by length descending to match longer patterns first (** before *)
    arithmetic: [...ARITHMETIC_OPS].map(escapeOp).sort((a, b) => b.length - a.length).join("|"),
    comparison: [...COMPARISON_OPS].map(escapeOp).sort((a, b) => b.length - a.length).join("|"),
    logical: [...LOGICAL_OPS].map(escapeOp).sort((a, b) => b.length - a.length).join("|"),
    bitwise: [...BITWISE_OPS].map(escapeOp).sort((a, b) => b.length - a.length).join("|"),
  };
}

/**
 * Build threading macro pattern from THREADING_MACROS.
 */
function buildThreadingPattern(): string {
  // Sort by length descending to match longer patterns first
  return [...THREADING_MACROS]
    .sort((a, b) => b.length - a.length)
    .map(m => escapeForRegex(m))
    .join("|");
}

/**
 * Build function pattern from getAllKnownIdentifiers().
 * Excludes operators, keywords, and internal functions.
 */
function buildFunctionPattern(): string {
  const allIds = getAllKnownIdentifiers();
  const macroNames = extractMacroNames();

  // Build exclusion sets
  const operatorSet = new Set(ALL_OPERATOR_NAMES);
  const keywordSet = new Set([
    ...KERNEL_PRIMITIVES,
    ...DECLARATION_KEYWORDS,
    ...BINDING_KEYWORDS,
    ...JS_LITERAL_KEYWORDS,
    ...CONTROL_FLOW_KEYWORDS,
  ]);

  const functions = allIds.filter(id => {
    // Skip operators
    if (operatorSet.has(id)) return false;
    // Skip keywords
    if (keywordSet.has(id)) return false;
    // Skip internal functions (% prefix) and private (_ prefix)
    if (id.startsWith("%") || id.startsWith("_")) return false;
    // Skip JS interop paths
    if (id.includes("/")) return false;
    // Keep only valid identifiers
    return /^[a-zA-Z][a-zA-Z0-9_?!\-]*$/.test(id);
  });

  // Escape special chars for regex (? and -)
  // Single backslash - JSON.stringify will add the second
  const escaped = functions.map(f =>
    f.replace(/\?/g, "\\?").replace(/-/g, "\\-")
  );

  return escaped.join("|");
}

/**
 * Build constants pattern from ALL_CONSTANT_KEYWORDS (single source of truth).
 */
function buildConstantPattern(): string {
  return [...ALL_CONSTANT_KEYWORDS].join("|");
}

/**
 * Generate the full tmLanguage.json structure.
 */
function generateGrammar(): object {
  const controlKeywords = buildControlKeywordPattern();
  const declarations = buildDeclarationPattern();
  const logicalWords = buildLogicalWordPattern();
  const constants = buildConstantPattern();
  const functions = buildFunctionPattern();
  const operators = buildOperatorPatterns();
  const threading = buildThreadingPattern();

  return {
    "$schema": "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
    "name": "HQL",
    "scopeName": "source.hql",
    "fileTypes": ["hql"],
    "patterns": [
      { "include": "#comment" },
      { "include": "#string" },
      { "include": "#number" },
      { "include": "#keyword" },
      { "include": "#constant" },
      { "include": "#function" },
      { "include": "#operator" },
      { "include": "#special" },
      { "include": "#bracket" }
    ],
    "repository": {
      "comment": {
        "patterns": [
          {
            "name": "comment.line.semicolon.hql",
            "match": ";;.*$"
          }
        ]
      },
      "string": {
        "patterns": [
          {
            "name": "string.quoted.double.hql",
            "begin": "\"",
            "end": "\"",
            "patterns": [
              { "name": "constant.character.escape.hql", "match": "\\\\." }
            ]
          },
          {
            "name": "string.quoted.template.hql",
            "begin": "`",
            "end": "`",
            "patterns": [
              { "name": "constant.character.escape.hql", "match": "\\\\." }
            ]
          }
        ]
      },
      "number": {
        "patterns": [
          { "name": "constant.numeric.hex.hql", "match": "\\b0[xX][0-9a-fA-F]+\\b" },
          { "name": "constant.numeric.binary.hql", "match": "\\b0[bB][01]+\\b" },
          { "name": "constant.numeric.octal.hql", "match": "\\b0[oO][0-7]+\\b" },
          { "name": "constant.numeric.hql", "match": "\\b-?[0-9]+(\\.[0-9]+)?([eE][+-]?[0-9]+)?\\b" }
        ]
      },
      "keyword": {
        "patterns": [
          {
            "name": "keyword.control.hql",
            "match": `\\b(${controlKeywords})\\b`
          },
          {
            "name": "keyword.declaration.hql",
            "match": `\\b(${declarations})\\b`
          },
          {
            "name": "keyword.operator.logical.word.hql",
            "match": `\\b(${logicalWords})\\b`
          }
        ]
      },
      "constant": {
        "patterns": [
          {
            "name": "constant.language.hql",
            "match": `\\b(${constants})\\b`
          },
          {
            "name": "constant.language.keyword.hql",
            "match": ":[a-zA-Z_][a-zA-Z0-9_-]*"
          }
        ]
      },
      "function": {
        "patterns": [
          // HQL function definition: (fn name [params] body)
          {
            "name": "entity.name.function.definition.hql",
            "match": "(?<=\\(fn\\s+)[a-zA-Z_][a-zA-Z0-9_-]*"
          },
          // HQL macro definition: (macro name [params] body)
          // NOTE: defn and defmacro DO NOT EXIST in HQL!
          {
            "name": "entity.name.function.definition.hql",
            "match": "(?<=\\(macro\\s+)[a-zA-Z_][a-zA-Z0-9_-]*"
          },
          {
            "name": "entity.name.class.hql",
            "match": "(?<=\\(class\\s+)[A-Z][a-zA-Z0-9_]*"
          },
          {
            "name": "entity.name.type.enum.hql",
            "match": "(?<=\\(enum\\s+)[A-Z][a-zA-Z0-9_]*"
          },
          {
            "name": "support.function.builtin.hql",
            "match": `\\b(${functions})\\b`
          }
        ]
      },
      "operator": {
        "patterns": [
          {
            "name": "keyword.operator.arithmetic.hql",
            "match": `(${operators.arithmetic})`
          },
          {
            "name": "keyword.operator.comparison.hql",
            "match": `(${operators.comparison})`
          },
          {
            "name": "keyword.operator.logical.hql",
            "match": `(${operators.logical})`
          },
          {
            "name": "keyword.operator.bitwise.hql",
            "match": `(${operators.bitwise})`
          },
          {
            "name": "keyword.operator.arrow.hql",
            "match": "=>"
          },
          {
            "name": "keyword.operator.threading.hql",
            "match": `(${threading})`
          }
        ]
      },
      "special": {
        "patterns": [
          {
            "name": "variable.language.special.hql",
            "match": "\\$[0-9]+"
          },
          {
            "name": "punctuation.definition.quote.hql",
            "match": "[`'~@]"
          },
          {
            "name": "variable.other.member.hql",
            "match": "\\.[a-zA-Z_][a-zA-Z0-9_]*"
          }
        ]
      },
      "bracket": {
        "patterns": [
          { "name": "punctuation.paren.hql", "match": "[()]" },
          { "name": "punctuation.bracket.hql", "match": "[\\[\\]]" },
          { "name": "punctuation.brace.hql", "match": "[{}]" }
        ]
      }
    }
  };
}

// Main
async function main() {
  console.log("Generating HQL TextMate grammar from SINGLE SOURCE OF TRUTH...\n");

  // IMPORTANT: Wait for stdlib to load before generating grammar
  await initializeIdentifiers();

  const grammar = generateGrammar();

  // Stats
  const allIds = getAllKnownIdentifiers();
  const macros = extractMacroNames();

  console.log("Sources used:");
  console.log(`  - KERNEL_PRIMITIVES: ${KERNEL_PRIMITIVES.size} items`);
  console.log(`  - ARITHMETIC_OPS: ${ARITHMETIC_OPS.length} operators`);
  console.log(`  - COMPARISON_OPS: ${COMPARISON_OPS.length} operators`);
  console.log(`  - LOGICAL_OPS: ${LOGICAL_OPS.length} operators`);
  console.log(`  - BITWISE_OPS: ${BITWISE_OPS.length} operators`);
  console.log(`  - CONTROL_FLOW_KEYWORDS: ${CONTROL_FLOW_KEYWORDS.length} items`);
  console.log(`  - THREADING_MACROS: ${THREADING_MACROS.length} items`);
  console.log(`  - DECLARATION_KEYWORDS: ${DECLARATION_KEYWORDS.length} items`);
  console.log(`  - DECLARATION_SPECIAL_FORMS: ${DECLARATION_SPECIAL_FORMS.length} items`);
  console.log(`  - MODULE_SYNTAX_KEYWORDS: ${MODULE_SYNTAX_KEYWORDS.length} items`);
  console.log(`  - BINDING_KEYWORDS: ${BINDING_KEYWORDS.length} items`);
  console.log(`  - ALL_CONSTANT_KEYWORDS: ${ALL_CONSTANT_KEYWORDS.length} items`);
  console.log(`  - WORD_LOGICAL_OPERATORS: ${WORD_LOGICAL_OPERATORS.length} items`);
  console.log(`  - getAllKnownIdentifiers(): ${allIds.length} items`);
  console.log(`  - extractMacroNames(): ${macros.length} macros`);

  const outputPath = new URL("../syntaxes/hql.tmLanguage.json", import.meta.url);
  await Deno.writeTextFile(outputPath, JSON.stringify(grammar, null, 2) + "\n");

  console.log(`\nGenerated: ${outputPath.pathname}`);
  console.log("\nNO HARDCODING - all patterns derived from source of truth!");
}

main();
