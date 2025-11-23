#!/usr/bin/env deno run -A

/**
 * HQL REPL - Interactive Read-Eval-Print Loop
 * Maintains state across expressions like Python/Node REPL
 */

import { transpile } from "../../mod.ts";
import { initializeRuntime } from "../src/common/runtime-initializer.ts";
import {
  getArgs as platformGetArgs,
  exit as platformExit,
  writeTextFile,
  readTextFile,
} from "../src/platform/platform.ts";
import { join, dirname } from "https://deno.land/std@0.220.0/path/mod.ts";
import { parse } from "../src/transpiler/pipeline/parser.ts";
import { isList, isSymbol, sexpToString } from "../src/s-exp/types.ts";
import type { SList } from "../src/s-exp/types.ts";
import { SimpleReadline } from "./simple-readline.ts";
import { ANSI_COLORS } from "./ansi.ts";

// Constants
const VERSION = "0.1.0";

const {
  DARK_PURPLE,
  PURPLE,
  CYAN,
  GREEN,
  YELLOW,
  RED,
  DIM_GRAY,
  BOLD,
  RESET,
} = ANSI_COLORS;

// Special form operators
const DECLARATION_OPS = new Set(["fn", "function", "defn", "class"] as const);
const BINDING_OPS = new Set(["let", "var"] as const);
const EXIT_COMMANDS = new Set(["close()", "(close)"] as const);

// Type definitions
type ExpressionKind = "declaration" | "binding" | "expression";

interface ExpressionType {
  readonly kind: ExpressionKind;
  readonly name?: string;
}

interface CodeGenResult {
  readonly code: string;
  readonly exportName?: string;
}

type CommandHandler = () => void | Promise<void>;

interface ReplState {
  lineNumber: number;
  declaredNames: Set<string>;
  modulePath: string;
}

/**
 * Print welcome message
 */
function printWelcome(): void {
  const banner = `
${BOLD}${PURPLE}██╗  ██╗ ██████╗ ██╗     ${RESET}
${BOLD}${PURPLE}██║  ██║██╔═══██╗██║     ${RESET}
${BOLD}${PURPLE}███████║██║   ██║██║     ${RESET}
${BOLD}${PURPLE}██╔══██║██║▄▄ ██║██║     ${RESET}
${BOLD}${PURPLE}██║  ██║╚██████╔╝███████╗${RESET}
${BOLD}${PURPLE}╚═╝  ╚═╝ ╚══▀▀═╝ ╚══════╝${RESET}

${DIM_GRAY}Version ${VERSION} • Lisp-like language for modern JavaScript${RESET}

${GREEN}Quick Start:${RESET}
  ${CYAN}(+ 1 2)${RESET}                    ${DIM_GRAY}→ Simple math${RESET}
  ${CYAN}(fn add [x y] (+ x y))${RESET}    ${DIM_GRAY}→ Define function${RESET}
  ${CYAN}(add 10 20)${RESET}                ${DIM_GRAY}→ Call function${RESET}

${YELLOW}Commands:${RESET} ${DIM_GRAY}.help | .clear | .reset | close()${RESET}
${YELLOW}Exit:${RESET}     ${DIM_GRAY}Ctrl+C | Ctrl+D | close()${RESET}
`;
  console.log(banner);
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Commands:
  close()            Exit REPL (or Ctrl+D, Ctrl+C twice)
  .help              Show this help
  .clear             Clear screen
  .reset             Reset REPL state

Keyboard Shortcuts:
  Ctrl+A             Jump to start of line
  Ctrl+E             Jump to end of line
  Ctrl+W             Delete word backward
  Ctrl+U             Delete to start of line
  Ctrl+K             Delete to end of line
  ↑/↓                Navigate history
  ←/→                Move cursor

Examples:
  (+ 1 2)                    → 3
  (print "Hello")            → Hello
  (fn add [x y] (+ x y))     → undefined
  (add 10 20)                → 30
  (let x 10)                 → undefined
  x                          → 10
`);
}

/**
 * Create persistent REPL module
 */
async function createReplModule(modulePath: string): Promise<void> {
  const initialCode = `// HQL REPL persistent module
// Auto-generated - do not edit

// Export all definitions for inspection
export const __repl_exports = {};
`;
  await writeTextFile(modulePath, initialCode);
}

/**
 * Cleanup temp directory
 */
async function cleanup(replDir: string): Promise<void> {
  try {
    await Deno.remove(replDir, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Clean transpiled JavaScript
 */
function cleanJs(js: string, removeTrailingSemicolon = false): string {
  let cleaned = js.replace(/^'use strict';\s*/gm, "").trim();
  if (removeTrailingSemicolon) {
    cleaned = cleaned.replace(/;$/, "");
  }
  return cleaned;
}

/**
 * Generate source comment for generated code
 */
function makeComment(lineNumber: number, input: string): string {
  const truncated = input.length > 60 ? input.slice(0, 60) + "..." : input;
  return `\n// Line ${lineNumber}: ${truncated}\n`;
}

/**
 * Extract function or class name from AST (more robust than regex)
 */
function extractDeclarationName(ast: SList): string | undefined {
  if (ast.elements.length > 1 && isSymbol(ast.elements[1])) {
    return ast.elements[1].name;
  }
  return undefined;
}

/**
 * Convert declaration to var assignment using AST info
 */
function convertToVarDeclaration(transpiled: string, name: string, isRedefinition: boolean): string {
  // More robust: check what we actually have
  const isFunctionDecl = transpiled.startsWith("function ");
  const isClassDecl = transpiled.startsWith("class ");

  if (!isFunctionDecl && !isClassDecl) {
    return transpiled; // Not a declaration we can convert
  }

  if (isRedefinition) {
    // Convert to assignment
    if (isFunctionDecl) {
      return transpiled.replace(/^function\s+\w+/, `${name} = function`);
    } else {
      return transpiled.replace(/^class\s+\w+/, `${name} = class`);
    }
  } else {
    // Convert to var declaration
    if (isFunctionDecl) {
      return transpiled.replace(/^function\s+\w+/, `var ${name} = function`);
    } else {
      return transpiled.replace(/^class\s+\w+/, `var ${name} = class`);
    }
  }
}

/**
 * Analyze expression type from AST
 */
function analyzeExpression(ast: SList): ExpressionType {
  if (!isList(ast) || ast.elements.length === 0 || !isSymbol(ast.elements[0])) {
    return { kind: "expression" };
  }

  const op = ast.elements[0].name;

  if (DECLARATION_OPS.has(op)) {
    return {
      kind: "declaration",
      name: extractDeclarationName(ast)
    };
  }

  if (BINDING_OPS.has(op) && ast.elements.length >= 3) {
    const name = isSymbol(ast.elements[1]) ? ast.elements[1].name : undefined;
    return { kind: "binding", name };
  }

  return { kind: "expression" };
}

/**
 * Generate code for variable binding
 * Exports initialization function to prevent O(n²) re-execution
 */
async function generateBindingCode(
  expr: SList,
  name: string,
  isRedefinition: boolean,
  transpileHql: (source: string) => Promise<string>,
  comment: string,
  lineNumber: number
): Promise<CodeGenResult> {
  const valueExpr = expr.elements[2];
  const valueSource = sexpToString(valueExpr);
  const jsValue = cleanJs(await transpileHql(valueSource), true);

  // Export initialization function
  // Only executes when called (prevents re-execution on import)
  const exportName = `__repl_line_${lineNumber}`;
  const initFlagName = `__init_${lineNumber}`;

  const code = `${comment}${isRedefinition ? '' : 'var ' + name + ';\n'}let ${initFlagName} = false;
export function ${exportName}() {
  if (${initFlagName}) {
    // Already initialized - return cached result
    return { success: true, value: ${name} };
  }
  ${initFlagName} = true;
  try {
    const __value = ${jsValue};
    ${name} = __value;
    return { success: true, value: __value };
  } catch (__error) {
    return { success: false, error: __error };
  }
}\n`;

  return {
    code,
    exportName
  };
}

/**
 * Generate code for function/class declaration
 */
async function generateDeclarationCode(
  input: string,
  name: string | undefined,
  isRedefinition: boolean,
  transpileHql: (source: string) => Promise<string>,
  comment: string,
  lineNumber: number
): Promise<CodeGenResult> {
  let transpiled = cleanJs(await transpileHql(input));
  const exportName = `__repl_line_${lineNumber}`;

  if (name) {
    transpiled = convertToVarDeclaration(transpiled, name, isRedefinition);
  }

  return {
    code: `${comment}${transpiled}\nexport const ${exportName} = undefined;\n`,
    exportName
  };
}

/**
 * Generate code for expression
 * Exports a FUNCTION that returns {success, value, error}
 * This prevents O(n²) re-execution on every import
 */
async function generateExpressionCode(
  input: string,
  transpileHql: (source: string) => Promise<string>,
  comment: string,
  lineNumber: number
): Promise<CodeGenResult> {
  const exportName = `__repl_line_${lineNumber}`;
  const transpiled = cleanJs(await transpileHql(input), true);

  // Export a FUNCTION, not an executed IIFE
  // This way it only executes when we call it
  const code = `${comment}export function ${exportName}() {
  try {
    const __result = ${transpiled};
    return { success: true, value: __result };
  } catch (__error) {
    return { success: false, error: __error };
  }
}\n`;

  return {
    code,
    exportName
  };
}

/**
 * Display error with proper formatting (Deno/Clojure-inspired)
 */
function displayError(error: unknown): void {
  const errorObj = error instanceof Error ? error : new Error(String(error));

  // Red "Error:" prefix
  console.error(`${RED}${BOLD}Error:${RESET} ${errorObj.message}`);

  // Stack trace in dimmed color (if available and useful)
  if (errorObj.stack) {
    const stackLines = errorObj.stack.split('\n').slice(1); // Skip first line (message)
    const relevantStack = stackLines
      .filter(line => !line.includes('node_modules') && !line.includes('deno/'))
      .slice(0, 3); // Show max 3 stack frames

    if (relevantStack.length > 0) {
      console.error(`${DIM_GRAY}${relevantStack.join('\n')}${RESET}`);
    }
  }
}

/**
 * Format result for display
 */
function formatResult(result: unknown): string {
  const arrow = `${DARK_PURPLE}=>${RESET}`;

  // Undefined and null - dimmed
  if (result === undefined) {
    return `${arrow} ${DIM_GRAY}undefined${RESET}`;
  }
  if (result === null) {
    return `${arrow} ${DIM_GRAY}null${RESET}`;
  }

  // Functions - cyan
  if (typeof result === "function") {
    return `${arrow} ${CYAN}<function>${RESET}`;
  }

  // Numbers - green
  if (typeof result === "number") {
    return `${arrow} ${GREEN}${result}${RESET}`;
  }

  // Booleans - cyan
  if (typeof result === "boolean") {
    return `${arrow} ${CYAN}${result}${RESET}`;
  }

  // Strings - yellow
  if (typeof result === "string") {
    return `${arrow} ${YELLOW}${JSON.stringify(result)}${RESET}`;
  }

  // Default - no color
  return `${arrow} ${String(result)}`;
}

/**
 * Display evaluation result
 */
function displayResult(result: unknown): void {
  const formatted = formatResult(result);
  console.log(formatted);
}

/**
 * Process a single REPL input
 */
async function processInput(
  input: string,
  modulePath: string,
  lineNumber: number,
  declaredNames: Set<string>,
  transpileHql: (source: string) => Promise<string>
): Promise<{ newLineNumber: number; success: boolean }> {
  try {
    const ast = parse(input, "<repl>");
    if (ast.length === 0) {
      return { newLineNumber: lineNumber, success: true };
    }

    const exprType = analyzeExpression(ast[0] as SList);
    const currentModule = await readTextFile(modulePath);
    const comment = makeComment(lineNumber, input);

    // Generate code based on expression type
    let result: CodeGenResult;

    if (exprType.kind === "binding" && exprType.name) {
      const isRedefinition = declaredNames.has(exprType.name);
      result = await generateBindingCode(
        ast[0] as SList,
        exprType.name,
        isRedefinition,
        transpileHql,
        comment,
        lineNumber
      );
      if (!isRedefinition) declaredNames.add(exprType.name);
    } else if (exprType.kind === "declaration") {
      const isRedefinition = exprType.name ? declaredNames.has(exprType.name) : false;
      result = await generateDeclarationCode(
        input,
        exprType.name,
        isRedefinition,
        transpileHql,
        comment,
        lineNumber
      );
      if (exprType.name && !isRedefinition) declaredNames.add(exprType.name);
    } else {
      result = await generateExpressionCode(
        input,
        transpileHql,
        comment,
        lineNumber
      );
    }

    const newLineNumber = lineNumber + 1;

    // Write code to module
    await writeTextFile(modulePath, currentModule + result.code);

    // Import and check result
    if (result.exportName) {
      try {
        const module = await import(`file://${modulePath}?t=${Date.now()}`);
        const exportedItem = module[result.exportName];

        // Check if this is a function (from generateExpressionCode)
        if (typeof exportedItem === 'function') {
          // Call the function to execute the expression
          const wrappedResult = exportedItem();
          if (wrappedResult.success) {
            displayResult(wrappedResult.value);
          } else {
            displayError(wrappedResult.error);
          }
        } else if (exportedItem && typeof exportedItem === 'object' && 'success' in exportedItem) {
          // Wrapped result from bindings
          if (exportedItem.success) {
            displayResult(exportedItem.value);
          } else {
            displayError(exportedItem.error);
          }
        } else {
          // Direct value (from declarations)
          displayResult(exportedItem);
        }

        return { newLineNumber, success: true };
      } catch (importError) {
        // This should rarely happen now (only parse/transpile errors)
        displayError(importError);
        return { newLineNumber, success: false };
      }
    } else {
      // Declarations and bindings - no result to display
      return { newLineNumber, success: true };
    }
  } catch (error) {
    displayError(error);
    // Always increment line number even on error to avoid duplicate export names
    return { newLineNumber: lineNumber + 1, success: false };
  }
}

/**
 * Handle REPL command execution
 */
async function handleReplCommand(
  command: string,
  handlers: Record<string, CommandHandler>,
): Promise<void> {
  const handler = handlers[command];
  if (handler) {
    await handler();
  } else {
    console.error(`Unknown command: ${command}. Type .help for help.`);
  }
}

/**
 * Initialize REPL state
 */
async function initializeReplState(): Promise<ReplState> {
  const replDir = await Deno.makeTempDir({ prefix: "hql-repl-" });
  const modulePath = join(replDir, "repl-module.mjs");
  await createReplModule(modulePath);

  return {
    lineNumber: 3, // Start after initial comment
    declaredNames: new Set<string>(),
    modulePath,
  };
}

/**
 * Main REPL loop
 */
async function startRepl(): Promise<void> {
  printWelcome();

  // Initialize runtime once
  const startTime = Date.now();
  await initializeRuntime();
  const initTime = Date.now() - startTime;
  console.log(`${DIM_GRAY}⚡ Ready in ${initTime}ms${RESET}\n`);

  // Initialize REPL state
  const state = await initializeReplState();
  let { lineNumber, modulePath } = state;
  const { declaredNames } = state;
  const rl = new SimpleReadline();

  // Transpilation helper
  const transpileHql = (source: string) =>
    transpile(source, {
      baseDir: Deno.cwd(),
      currentFile: `<repl>:${lineNumber}`,
    });

  // Exit handler
  const handleExit = async () => {
    console.log("Goodbye!");
    const replDir = dirname(modulePath);
    await cleanup(replDir);
    platformExit(0);
  };

  // Reset handler
  const handleReset = async () => {
    await createReplModule(modulePath);
    lineNumber = 3;
    declaredNames.clear();
    console.log("REPL state reset");
  };

  // Command handlers
  const commands: Record<string, CommandHandler> = {
    ".help": printHelp,
    ".h": printHelp,
    ".version": () => console.log(`HQL REPL v${VERSION}`),
    ".v": () => console.log(`HQL REPL v${VERSION}`),
    ".clear": () => console.clear(),
    ".c": () => console.clear(),
    ".reset": handleReset,
    ".r": handleReset,
  };

  // Main REPL loop
  while (true) {
    const input = await rl.readline("hql>");

    // Handle EOF
    if (input === null) {
      await handleExit();
      return; // Unreachable but makes TypeScript happy
    }

    const trimmedInput = input.trim();

    // Skip empty lines
    if (trimmedInput === "") {
      continue;
    }

    // Handle exit commands
    if (EXIT_COMMANDS.has(trimmedInput)) {
      await handleExit();
      return; // Unreachable but makes TypeScript happy
    }

    // Handle REPL commands
    if (trimmedInput.startsWith(".")) {
      await handleReplCommand(trimmedInput, commands);
      continue;
    }

    // Process HQL expression
    const { newLineNumber } = await processInput(
      trimmedInput,
      modulePath,
      lineNumber,
      declaredNames,
      transpileHql
    );
    lineNumber = newLineNumber;
  }
}

/**
 * Entry point
 */
export async function main(args: string[] = platformGetArgs()): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
HQL REPL - Interactive Read-Eval-Print Loop

USAGE:
  hql repl [options]

OPTIONS:
  --help, -h        Show this help
  --version         Show version

EXAMPLES:
  hql repl          Start interactive REPL
`);
    return 0;
  }

  if (args.includes("--version")) {
    console.log(`HQL REPL v${VERSION}`);
    return 0;
  }

  await startRepl();
  return 0;
}

if (import.meta.main) {
  const exitCode = await main();
  platformExit(exitCode);
}
