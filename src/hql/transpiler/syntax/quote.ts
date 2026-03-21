// src/hql/transpiler/syntax/quote.ts
// Runtime quote-family lowering to real S-expression values

import * as IR from "../type/hql_ir.ts";
import type {
  HQLNode,
  ListNode,
  SymbolNode,
  TransformNodeFn,
} from "../type/hql_ast.ts";
import { copyPosition } from "../pipeline/hql-ast-to-hql-ir.ts";
import {
  createArr,
  createCall,
  createId,
  createNull,
  createNum,
  createStr,
} from "../utils/ir-helpers.ts";
import {
  arityError,
  extractPosition,
  syntaxError,
  validateListLength,
  validateTransformed,
} from "../utils/validation-helpers.ts";
import { globalSymbolTable, type SymbolTable } from "../symbol_table.ts";
import {
  createSymbol,
  getMeta,
  isForm,
  isList,
  isLiteral,
  isSymbol,
  type ResolvedBindingMeta,
  type SExpMeta,
} from "../../s-exp/types.ts";
import {
  processTemplateQuote,
  type TemplateQuoteContext,
} from "../../s-exp/template-quote.ts";
import {
  KERNEL_PRIMITIVES,
  PRIMITIVE_DATA_STRUCTURE,
  PRIMITIVE_OPS,
} from "../keyword/primitives.ts";
import { canonicalizeModuleId } from "../utils/module-identity.ts";

export interface RuntimeQuoteTransformContext {
  symbolTable: SymbolTable;
  lexicalBindingCounter: number;
  autoGensymCounter: number;
}

export function createRuntimeQuoteTransformContext(
  symbolTable: SymbolTable = globalSymbolTable,
): RuntimeQuoteTransformContext {
  return {
    symbolTable,
    lexicalBindingCounter: 0,
    autoGensymCounter: 0,
  };
}

function createBooleanLiteral(value: boolean): IR.IRBooleanLiteral {
  return {
    type: IR.IRNodeType.BooleanLiteral,
    value,
  } as IR.IRBooleanLiteral;
}

function getNodeFilePath(
  node: HQLNode,
  fallback?: string,
): string | undefined {
  return getMeta(node)?.filePath ?? fallback;
}

function resolveNonLocalBinding(
  symbol: SymbolNode,
  currentFile?: string,
  symbolTable: SymbolTable = globalSymbolTable,
): ResolvedBindingMeta | undefined {
  const symbolInfo = symbolTable.get(symbol.name) ??
    globalSymbolTable.get(symbol.name);
  const canonicalCurrentFile = currentFile
    ? canonicalizeModuleId(currentFile, currentFile)
    : undefined;

  if (symbolInfo?.sourceModule) {
    return {
      kind: "module",
      exportName: symbolInfo.aliasOf ?? symbol.name,
      modulePath: canonicalizeModuleId(
        symbolInfo.sourceModule,
        symbolInfo.sourceModule,
      ),
      originalName: symbol.name,
      importedFrom: symbolInfo.isImported ? symbolInfo.sourceModule : undefined,
    };
  }

  if (symbolInfo?.kind === "special-form") {
    return {
      kind: "module",
      exportName: symbol.name,
      modulePath: "<special-form>",
    };
  }

  if (symbolInfo?.kind === "builtin" || symbolInfo?.kind === "operator") {
    return {
      kind: "module",
      exportName: symbol.name,
      modulePath: "<builtin>",
    };
  }

  if (KERNEL_PRIMITIVES.has(symbol.name)) {
    return {
      kind: "module",
      exportName: symbol.name,
      modulePath: "<special-form>",
    };
  }

  if (
    PRIMITIVE_OPS.has(symbol.name) || PRIMITIVE_DATA_STRUCTURE.has(symbol.name)
  ) {
    return {
      kind: "module",
      exportName: symbol.name,
      modulePath: "<builtin>",
    };
  }

  return canonicalCurrentFile && symbolInfo?.sourceModule === canonicalCurrentFile
    ? {
      kind: "module",
      exportName: symbol.name,
      modulePath: canonicalCurrentFile,
      originalName: symbol.name,
    }
    : undefined;
}

function createTemplateQuoteContext(
  runtimeContext: RuntimeQuoteTransformContext,
  currentFile?: string,
): TemplateQuoteContext {
  return {
    mode: "preserve",
    currentFile,
    fail(formName, message, node) {
      throw syntaxError(formName, message, extractPosition(node));
    },
    resolveNonLocalBinding(symbol, filePath) {
      return resolveNonLocalBinding(
        symbol,
        filePath,
        runtimeContext.symbolTable,
      );
    },
    createLocalBinding(name) {
      return {
        kind: "local",
        exportName: name,
        lexicalId:
          `runtime-template-local-${++runtimeContext.lexicalBindingCounter}`,
      };
    },
    createAutoGensym(baseName) {
      return createSymbol(`${baseName}_${runtimeContext.autoGensymCounter++}`);
    },
  };
}

function createObjectProperty(
  key: string,
  value: IR.IRNode,
): IR.IRObjectProperty {
  return {
    type: IR.IRNodeType.ObjectProperty,
    key: createId(key),
    value,
  } as IR.IRObjectProperty;
}

function createObjectExpression(
  properties: IR.IRObjectProperty[],
): IR.IRObjectExpression {
  return {
    type: IR.IRNodeType.ObjectExpression,
    properties,
  } as IR.IRObjectExpression;
}

function createMetaLiteral(
  value: unknown,
): IR.IRNode {
  if (value === null || value === undefined) {
    return createNull();
  }
  if (typeof value === "string") {
    return createStr(value);
  }
  if (typeof value === "number") {
    return createNum(value);
  }
  if (typeof value === "boolean") {
    return createBooleanLiteral(value);
  }
  return createNull();
}

function createMetaExpression(
  meta?: SExpMeta,
): IR.IRObjectExpression | null {
  if (!meta) {
    return null;
  }

  const properties: IR.IRObjectProperty[] = [];

  if (meta.filePath !== undefined) {
    properties.push(createObjectProperty("filePath", createStr(meta.filePath)));
  }
  if (meta.line !== undefined) {
    properties.push(createObjectProperty("line", createNum(meta.line)));
  }
  if (meta.column !== undefined) {
    properties.push(createObjectProperty("column", createNum(meta.column)));
  }
  if (meta.endLine !== undefined) {
    properties.push(createObjectProperty("endLine", createNum(meta.endLine)));
  }
  if (meta.endColumn !== undefined) {
    properties.push(
      createObjectProperty("endColumn", createNum(meta.endColumn)),
    );
  }

  if (meta.resolvedBinding) {
    const binding = meta.resolvedBinding;
    const bindingProps: IR.IRObjectProperty[] = [
      createObjectProperty("kind", createStr(binding.kind)),
      createObjectProperty("exportName", createStr(binding.exportName)),
    ];
    if (binding.lexicalId !== undefined) {
      bindingProps.push(
        createObjectProperty("lexicalId", createStr(binding.lexicalId)),
      );
    }
    if (binding.modulePath !== undefined) {
      bindingProps.push(
        createObjectProperty("modulePath", createStr(binding.modulePath)),
      );
    }
    if (binding.originalName !== undefined) {
      bindingProps.push(
        createObjectProperty("originalName", createStr(binding.originalName)),
      );
    }
    if (binding.importedFrom !== undefined) {
      bindingProps.push(
        createObjectProperty("importedFrom", createStr(binding.importedFrom)),
      );
    }
    properties.push(
      createObjectProperty(
        "resolvedBinding",
        createObjectExpression(bindingProps),
      ),
    );
  }

  if (meta._meta) {
    const nested = createMetaExpression(meta._meta);
    if (nested) {
      properties.push(createObjectProperty("_meta", nested));
    }
  }

  return properties.length > 0 ? createObjectExpression(properties) : null;
}

function createLiteralSExp(
  node: HQLNode,
  value: unknown,
): IR.IRObjectExpression {
  const properties: IR.IRObjectProperty[] = [
    createObjectProperty("type", createStr("literal")),
    createObjectProperty("value", createMetaLiteral(value)),
  ];

  const metaExpr = createMetaExpression(getMeta(node));
  if (metaExpr) {
    properties.push(createObjectProperty("_meta", metaExpr));
  }

  const result = createObjectExpression(properties);
  copyPosition(node, result);
  return result;
}

function createSymbolSExp(
  node: SymbolNode,
): IR.IRObjectExpression {
  const properties: IR.IRObjectProperty[] = [
    createObjectProperty("type", createStr("symbol")),
    createObjectProperty("name", createStr(node.name)),
  ];

  const metaExpr = createMetaExpression(getMeta(node));
  if (metaExpr) {
    properties.push(createObjectProperty("_meta", metaExpr));
  }

  const result = createObjectExpression(properties);
  copyPosition(node, result);
  return result;
}

function createListSExp(
  node: HQLNode,
  elementsExpr: IR.IRNode,
): IR.IRObjectExpression {
  const properties: IR.IRObjectProperty[] = [
    createObjectProperty("type", createStr("list")),
    createObjectProperty("elements", elementsExpr),
  ];

  const metaExpr = createMetaExpression(getMeta(node));
  if (metaExpr) {
    properties.push(createObjectProperty("_meta", metaExpr));
  }

  const result = createObjectExpression(properties);
  copyPosition(node, result);
  return result;
}

function createStaticSExp(node: HQLNode): IR.IRNode {
  if (isSymbol(node)) {
    return createSymbolSExp(node);
  }
  if (isLiteral(node)) {
    return createLiteralSExp(node, node.value);
  }
  return createListSExp(
    node,
    createArr(node.elements.map((element) => createStaticSExp(element))),
  );
}

function createConcatExpression(
  segments: IR.IRNode[],
): IR.IRNode {
  if (segments.length === 0) {
    return createArr([]);
  }
  if (segments.length === 1) {
    return segments[0];
  }
  return createCall(
    {
      type: IR.IRNodeType.MemberExpression,
      object: segments[0],
      property: createId("concat"),
      computed: false,
    } as IR.IRMemberExpression,
    segments.slice(1),
  );
}

function buildTemplateQuoteIR(
  node: HQLNode,
  depth: number,
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRNode {
  if (!isList(node)) {
    return createStaticSExp(node);
  }

  if (node.elements.length === 0) {
    return createListSExp(node, createArr([]));
  }

  const first = node.elements[0];
  if (
    isSymbol(first) &&
    (first.name === "quasiquote" || first.name === "syntax-quote")
  ) {
    validateListLength(node, 2, first.name);
    return createListSExp(
      node,
      createArr([
        createSymbolSExp(createSymbol(first.name)),
        buildTemplateQuoteIR(
          node.elements[1],
          depth + 1,
          currentDir,
          transformNode,
        ),
      ]),
    );
  }

  if (isSymbol(first) && first.name === "unquote") {
    validateListLength(node, 2, "unquote");
    if (depth === 0) {
      return createCall(
        createId("__hql_value_to_sexp"),
        [
          validateTransformed(
            transformNode(node.elements[1], currentDir),
            "unquote",
            "Unquoted expression",
          ),
        ],
      );
    }

    return createListSExp(
      node,
      createArr([
        createSymbolSExp(createSymbol("unquote")),
        buildTemplateQuoteIR(
          node.elements[1],
          depth - 1,
          currentDir,
          transformNode,
        ),
      ]),
    );
  }

  if (isSymbol(first) && first.name === "unquote-splicing") {
    validateListLength(node, 2, "unquote-splicing");
    if (depth === 0) {
      throw syntaxError(
        "quasiquote",
        "unquote-splicing may only appear within a list context",
        extractPosition(node),
      );
    }

    return createListSExp(
      node,
      createArr([
        createSymbolSExp(createSymbol("unquote-splicing")),
        buildTemplateQuoteIR(
          node.elements[1],
          depth - 1,
          currentDir,
          transformNode,
        ),
      ]),
    );
  }

  const segments: IR.IRNode[] = [];
  let chunk: IR.IRNode[] = [];
  let hasSplice = false;

  const flushChunk = () => {
    if (chunk.length === 0) {
      return;
    }
    segments.push(createArr(chunk));
    chunk = [];
  };

  for (const element of node.elements) {
    if (depth === 0 && isForm(element, "unquote-splicing")) {
      const spliceList = element as ListNode;
      if (spliceList.elements.length !== 2) {
        throw arityError(
          "unquote-splicing",
          1,
          spliceList.elements.length - 1,
          extractPosition(element),
        );
      }

      hasSplice = true;
      flushChunk();
      segments.push(
        createCall(
          createId("__hql_splice_to_sexp_items"),
          [
            validateTransformed(
              transformNode(spliceList.elements[1], currentDir),
              "quasiquote",
              "Unquote-spliced expression",
            ),
          ],
        ),
      );
      continue;
    }

    chunk.push(buildTemplateQuoteIR(element, depth, currentDir, transformNode));
  }

  flushChunk();

  if (!hasSplice) {
    return createListSExp(
      node,
      segments.length > 0 ? segments[0] : createArr([]),
    );
  }

  if (
    segments.length === 0 || segments[0].type !== IR.IRNodeType.ArrayExpression
  ) {
    segments.unshift(createArr([]));
  }

  return createListSExp(node, createConcatExpression(segments));
}

export function transformQuote(
  list: ListNode,
  _currentDir: string,
  _transformNode: TransformNodeFn,
  _runtimeContext: RuntimeQuoteTransformContext,
): IR.IRNode {
  validateListLength(list, 2, "quote");
  const result = createStaticSExp(list.elements[1]);
  copyPosition(list, result);
  return result;
}

export function transformQuasiquote(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
  runtimeContext: RuntimeQuoteTransformContext,
): IR.IRNode {
  validateListLength(list, 2, "quasiquote");

  const processed = processTemplateQuote(
    list.elements[1],
    "quasiquote",
    createTemplateQuoteContext(runtimeContext, getNodeFilePath(list, undefined)),
  );
  const result = buildTemplateQuoteIR(processed, 0, currentDir, transformNode);
  copyPosition(list, result);
  return result;
}

export function transformSyntaxQuote(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
  runtimeContext: RuntimeQuoteTransformContext,
): IR.IRNode {
  validateListLength(list, 2, "syntax-quote");

  const processed = processTemplateQuote(
    list.elements[1],
    "syntax-quote",
    createTemplateQuoteContext(runtimeContext, getNodeFilePath(list, undefined)),
  );
  const result = buildTemplateQuoteIR(processed, 0, currentDir, transformNode);
  copyPosition(list, result);
  return result;
}

export function transformUnquote(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRNode {
  validateListLength(list, 2, "unquote");
  return validateTransformed(
    transformNode(list.elements[1], currentDir),
    "unquote",
    "Unquoted expression",
  );
}

export function transformUnquoteSplicing(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRNode {
  validateListLength(list, 2, "unquote-splicing");
  return validateTransformed(
    transformNode(list.elements[1], currentDir),
    "unquote-splicing",
    "Unquote-spliced expression",
  );
}
