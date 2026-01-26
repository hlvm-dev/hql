/**
 * Remove ONLY the 'export' keyword from unused exports
 * This makes them internal declarations instead of deleting them
 */

// Map of files to exports that should have 'export' removed
const REMOVALS = new Map<string, string[]>([
  // Platform
  ["src/platform/platform.ts", ["setPlatform"]],
  ["src/platform/types.ts", ["PlatformCommandResult", "OperatingSystem"]],

  // ANSI
  ["src/hlvm/cli/ansi.ts", ["ANSI_CONTROLS"]],

  // REPL Keybindings
  ["src/hlvm/cli/repl-ink/keybindings/keybinding-lookup.ts", ["normalizeKeyInput"]],
  ["src/hlvm/cli/repl-ink/keybindings/handler-registry.ts", ["HandlerFn", "HandlerInfo", "hasHandler", "onRegistryChange", "HandlerId"]],

  // REPL Completion
  ["src/hlvm/cli/repl-ink/completion/providers.ts", ["detectEnclosingForm", "CreateItemOptions"]],
  ["src/hlvm/cli/repl-ink/completion/types.ts", ["CompletionSideEffect"]],
  ["src/hlvm/cli/repl-ink/completion/useDropdownState.ts", ["UseDropdownStateReturn"]],
  ["src/hlvm/cli/repl-ink/completion/Dropdown.tsx", ["GenericItem"]],

  // REPL Utils
  ["src/hlvm/cli/repl-ink/utils/model-info.ts", ["extractModelName"]],
  ["src/hlvm/cli/repl-ink/utils/text-editing.ts", [
    "TextEditResult", "KeyInfo", "handleCtrlA", "handleCtrlE", "handleCtrlW",
    "handleCtrlU", "handleCtrlK", "handleBackspace", "handleWordBack",
    "handleWordForward", "handleLeftArrow", "handleRightArrow", "insertChar"
  ]],

  // REPL Components
  ["src/hlvm/cli/repl-ink/components/HighlightedText.tsx", ["HighlightedTextProps"]],

  // REPL Hooks
  ["src/hlvm/cli/repl-ink/hooks/useHistorySearch.ts", ["HistoryMatch", "HistorySearchActions"]],
  ["src/hlvm/cli/repl-ink/hooks/useTaskManager.ts", ["UseTaskManagerReturn"]],
  ["src/hlvm/cli/repl-ink/hooks/useAttachments.ts", ["UseAttachmentsReturn"]],
  ["src/hlvm/cli/repl-ink/hooks/useRepl.ts", ["EvaluateOptions", "UseReplReturn"]],

  // REPL Core
  ["src/hlvm/cli/repl/paredit.ts", ["PareditResult"]],
  ["src/hlvm/cli/repl/history-storage.ts", ["HistoryStorageConfig"]],
  ["src/hlvm/cli/repl/syntax.ts", ["CLOSE_TO_OPEN", "OPEN_DELIMITERS", "CLOSE_DELIMITERS", "isInsideEmptyPair"]],
  ["src/hlvm/cli/repl/js-eval.ts", ["transformJSForRepl"]],
  ["src/hlvm/cli/repl/context.ts", ["HlvmMedia"]],
  ["src/hlvm/cli/repl/attachment.ts", ["AttachmentType", "AttachmentMetadata", "TEXT_COLLAPSE_MIN_LINES", "TEXT_COLLAPSE_MIN_CHARS", "getTextDisplayName"]],
  ["src/hlvm/cli/repl/file-search.ts", ["FileIndex"]],
  ["src/hlvm/cli/repl/string-utils.ts", ["isWordBoundary"]],
  ["src/hlvm/cli/repl/formatter.ts", ["formatError"]],
  ["src/hlvm/cli/repl/fuzzy.ts", ["calculateMinScore"]],
  ["src/hlvm/cli/repl/headless.ts", ["HeadlessReplOptions"]],

  // CLI Publish
  ["src/hlvm/cli/publish/publish_common.ts", ["PublishContext", "sanitizeModuleName", "createDefaultConfig"]],
  ["src/hlvm/cli/publish/utils.ts", ["RunCommandOptions"]],

  // CLI Theme
  ["src/hlvm/cli/theme/palettes.ts", ["solarizedDark", "solarizedLight"]],

  // API
  ["src/hlvm/api/errors.ts", ["ErrorsApi"]],
  ["src/hlvm/api/memory.ts", ["MemorySummary", "MemoryApi", "MemoryCallable"]],
  ["src/hlvm/api/log.ts", ["NamespacedLog", "LogApi"]],

  // Logger
  ["src/logger.ts", ["LogOptions", "TimingOptions"]],

  // Common
  ["src/common/ai-default-model.ts", ["EnsureDefaultModelOptions"]],
  ["src/common/legacy-migration.ts", ["getLegacyHqlDir"]],
  ["src/common/runtime-initializer.ts", ["InitOptions"]],
  ["src/common/known-identifiers.ts", [
    "BUILTIN_FUNCTION_NAMES", "ADDITIONAL_SPECIAL_FORMS", "DECLARATION_SPECIAL_FORMS",
    "MODULE_SYNTAX_KEYWORDS", "CONTROL_FLOW_KEYWORDS", "THREADING_MACROS",
    "JS_GLOBAL_NAMES", "extractMacroNames"
  ]],
  ["src/common/error-system.ts", ["ErrorSystemOptions", "getErrorConfig", "RunWithErrorHandlingOptions"]],
  ["src/common/paths.ts", ["getDebugLogPath"]],
  ["src/common/error.ts", ["RecoveryResult", "ErrorReporter"]],
  ["src/common/runtime-helpers.ts", ["HlvmHostApi"]],
  ["src/common/context-helpers.ts", ["ContextLine"]],
  ["src/common/http-client.ts", ["HttpOptions", "HttpResponse"]],
  ["src/common/runtime-helper-impl.ts", ["RUNTIME_HELPER_NAMES", "RuntimeHelperName", "getRuntimeHelperSource", "getRangeHelperWithDependency"]],

  // HQL Interpreter
  ["src/hql/interpreter/stdlib-bridge.ts", ["hqlToJs", "jsToHql"]],
  ["src/hql/interpreter/errors.ts", ["HQLTypeError", "HQLSyntaxError"]],
  ["src/hql/interpreter/types.ts", ["isBuiltinFn"]],

  // HQL Transpiler Pipeline
  ["src/hql/transpiler/pipeline/js-code-generator.ts", ["JavaScriptOutput", "GenerateJavaScriptOptions"]],
  ["src/hql/transpiler/pipeline/source-map-chain.ts", ["ChainedSourceMap"]],
  ["src/hql/transpiler/pipeline/ts-compiler.ts", ["TSCompileResult", "TSCompilerOptions"]],
  ["src/hql/transpiler/pipeline/hql-ast-to-hql-ir.ts", ["resetIIFEDepth"]],
  ["src/hql/transpiler/pipeline/source-map-support.ts", ["installSourceMapSupport"]],
  ["src/hql/transpiler/pipeline/syntax-transformer.ts", ["transformSExpNode"]],

  // HQL Transpiler Optimize
  ["src/hql/transpiler/optimize/tail-position-analyzer.ts", ["TailCallVisitor", "TailPositionAnalyzerOptions", "analyzeTailCalls"]],

  // HQL Transpiler Tokenizer
  ["src/hql/transpiler/tokenizer/type-tokenizer.ts", ["TypeTokenResult", "TypeExtractionResult"]],

  // HQL Transpiler Utils
  ["src/hql/transpiler/utils/ir-tree-walker.ts", [
    "containsNodeType", "ScopeWalkOptions", "containsMatchInScope",
    "forEachNodeInScope", "collectNodesInScope"
  ]],
  ["src/hql/transpiler/utils/symbol-registry.ts", [
    "SymbolLocation", "registerBuiltin", "registerModule", "registerImport",
    "registerExport", "registerVariable", "registerFunction", "registerTypeAlias", "batchRegister"
  ]],
  ["src/hql/transpiler/utils/escape-sequences.ts", [
    "SIMPLE_ESCAPES", "HEX_ESCAPE_REGEX", "UNICODE_ESCAPE_REGEX",
    "UNICODE_EXTENDED_REGEX", "EscapeResult", "processHexEscape", "processUnicodeEscape"
  ]],
  ["src/hql/transpiler/utils/source_location_utils.ts", ["SourceLocationOptions", "resolveSourceLocation"]],
  ["src/hql/transpiler/utils/validation-helpers.ts", [
    "missingError", "unsupportedError", "validateMinListLength",
    "validateSymbol", "validateList"
  ]],

  // HQL Transpiler Codegen
  ["src/hql/transpiler/codegen/code-buffer.ts", ["CodeBufferOptions", "CodeBufferResult"]],

  // HQL Transpiler Core
  ["src/hql/transpiler/hql-transpiler.ts", ["TranspileWithIRResult"]],
  ["src/hql/transpiler/compiler-context.ts", ["MacroDefinition"]],

  // HQL Transpiler Keywords
  ["src/hql/transpiler/keyword/primitives.ts", [
    "ARITHMETIC_OPS", "COMPARISON_OPS", "LOGICAL_OPS", "BITWISE_OPS",
    "ALL_DECLARATION_BINDING_KEYWORDS", "JS_LITERAL_KEYWORDS", "ALL_CONSTANT_KEYWORDS"
  ]],

  // HQL Transpiler Syntax
  ["src/hql/transpiler/syntax/enum.ts", ["parseEnumCase"]],
  ["src/hql/transpiler/syntax/primitive.ts", [
    "transformArithmeticOp", "transformComparisonOp", "transformBitwiseOp",
    "transformTypeOp", "transformLogicalOp", "transformEqualsOperator",
    "transformAssignment", "transformLogicalAssignment", "transformCompoundAssignment"
  ]],

  // HQL Core
  ["src/hql/macroexpand.ts", ["MacroExpandOptions"]],
  ["src/hql/transformer.ts", ["TransformOptions"]],
  ["src/hql/embedded-package-utils.ts", ["EmbeddedPackageLookup"]],
  ["src/hql/imports.ts", ["ImportProcessorOptions"]],
  ["src/hql/s-exp/types.ts", ["copyMeta", "isForm", "SexpToJsOptions"]],
]);

async function removeExportKeyword(file: string, exportName: string): Promise<boolean> {
  try {
    const content = await Deno.readTextFile(file);
    const lines = content.split("\n");
    let modified = false;

    const newLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check if this line exports the target - replace 'export ' with ''
      const regex = new RegExp(`^export\\s+(const|function|class|type|interface|enum)\\s+${exportName}\\b`);
      const match = line.match(regex);

      if (match) {
        // Remove 'export ' prefix, keep the rest
        const newLine = line.replace(/^export\s+/, '');
        newLines.push(newLine);
        modified = true;
        continue;
      }

      // Check for export { name } pattern
      if (line.includes(`export`) && line.includes(exportName)) {
        const exportMatch = line.match(/^export\s*\{([^}]+)\}/);
        if (exportMatch) {
          const names = exportMatch[1].split(",").map(n => n.trim().split(/\s+as\s+/)[0].trim());
          const filtered = names.filter(n => n !== exportName);

          if (filtered.length === 0) {
            // Remove entire export line
            modified = true;
            continue;
          } else if (filtered.length < names.length) {
            // Update line to remove just this export
            newLines.push(`export { ${filtered.join(", ")} };`);
            modified = true;
            continue;
          }
        }
      }

      newLines.push(line);
    }

    if (modified) {
      await Deno.writeTextFile(file, newLines.join("\n"));
      console.log(`✓ Removed export from ${exportName} in ${file}`);
      return true;
    }

    console.log(`⚠️  Pattern not found: ${exportName} in ${file}`);
    return false;
  } catch (error) {
    console.error(`✗ Error processing ${file}: ${error}`);
    return false;
  }
}

async function main() {
  console.log("🗑️  Removing 'export' keywords from unused exports...\n");

  let removed = 0;
  let failed = 0;

  for (const [file, exports] of REMOVALS) {
    console.log(`\n📁 ${file}`);
    for (const exp of exports) {
      const success = await removeExportKeyword(file, exp);
      if (success) removed++;
      else failed++;
    }
  }

  console.log(`\n\n📊 Summary:`);
  console.log(`   Unexported: ${removed}`);
  console.log(`   Failed: ${failed}`);
}

main();
