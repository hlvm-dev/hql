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
  addResolvedBindings,
  attachResolvedBindingMeta,
  cloneResolvedBindingMap,
  createListFrom,
  createSymbol,
  getMeta,
  isForm,
  isList,
  isLiteral,
  isSymbol,
  type ResolvedBindingMeta,
  type SExpMeta,
} from "../../s-exp/types.ts";
import { couldBePattern } from "../../s-exp/pattern-parser.ts";
import {
  hasArrayLiteralPrefix,
  hasHashMapPrefix,
} from "../../../common/sexp-utils.ts";
import {
  KERNEL_PRIMITIVES,
  PRIMITIVE_DATA_STRUCTURE,
  PRIMITIVE_OPS,
} from "../keyword/primitives.ts";

type TemplateQuoteKind = "quasiquote" | "syntax-quote";

interface TemplateState {
  quoteKind: TemplateQuoteKind;
  autoGensymMap: Map<string, SymbolNode>;
  templateBindings: Map<string, ResolvedBindingMeta>;
  currentFile?: string;
}

interface TemplateBindingTargetResult {
  expr: HQLNode;
  bindings: ResolvedBindingMeta[];
}

let currentSymbolTable: SymbolTable = globalSymbolTable;
let templateLexicalBindingCounter = 0;
let templateAutoGensymCounter = 0;

export function setCurrentSymbolTable(table: SymbolTable): void {
  currentSymbolTable = table;
}

function createBooleanLiteral(value: boolean): IR.IRBooleanLiteral {
  return {
    type: IR.IRNodeType.BooleanLiteral,
    value,
  } as IR.IRBooleanLiteral;
}

function createLocalBindingMeta(name: string): ResolvedBindingMeta {
  return {
    kind: "local",
    exportName: name,
    lexicalId: `runtime-template-local-${++templateLexicalBindingCounter}`,
  };
}

function getNodeFilePath(
  node: HQLNode,
  fallback?: string,
): string | undefined {
  return getMeta(node)?.filePath ?? fallback;
}

function getAutoGensym(name: string, state: TemplateState): SymbolNode {
  const existing = state.autoGensymMap.get(name);
  if (existing) {
    return existing;
  }

  const generated = createSymbol(
    `${name.slice(0, -1)}_${templateAutoGensymCounter++}`,
  );
  state.autoGensymMap.set(name, generated);
  return generated;
}

function resolveNonLocalBinding(
  symbol: SymbolNode,
  currentFile?: string,
): ResolvedBindingMeta | undefined {
  const symbolInfo = currentSymbolTable.get(symbol.name) ??
    globalSymbolTable.get(symbol.name);

  if (symbolInfo?.sourceModule) {
    return {
      kind: "module",
      exportName: symbolInfo.aliasOf ?? symbol.name,
      modulePath: symbolInfo.sourceModule,
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

  return currentFile && symbolInfo?.sourceModule === currentFile
    ? {
      kind: "module",
      exportName: symbol.name,
      modulePath: currentFile,
      originalName: symbol.name,
    }
    : undefined;
}

function preprocessSymbol(
  symbol: SymbolNode,
  depth: number,
  state: TemplateState,
): SymbolNode {
  if (depth === 0 && symbol.name.endsWith("#")) {
    return getAutoGensym(symbol.name, state);
  }

  if (state.quoteKind !== "syntax-quote" || depth !== 0) {
    return symbol;
  }

  const templateBinding = state.templateBindings.get(symbol.name);
  if (templateBinding) {
    return attachResolvedBindingMeta(symbol, templateBinding);
  }

  const resolvedBinding = resolveNonLocalBinding(symbol, state.currentFile);
  return resolvedBinding
    ? attachResolvedBindingMeta(symbol, resolvedBinding)
    : symbol;
}

function annotateBindingTarget(
  target: HQLNode,
): TemplateBindingTargetResult {
  if (isSymbol(target)) {
    if (target.name === "_") {
      return { expr: target, bindings: [] };
    }

    const binding = createLocalBindingMeta(target.name);
    return {
      expr: attachResolvedBindingMeta(target, binding),
      bindings: [binding],
    };
  }

  if (!isList(target)) {
    return { expr: target, bindings: [] };
  }

  if (hasHashMapPrefix(target)) {
    const bindings: ResolvedBindingMeta[] = [];
    const elements: HQLNode[] = [target.elements[0]];

    for (let i = 1; i < target.elements.length; i += 2) {
      const keyNode = target.elements[i];
      const valueNode = target.elements[i + 1];
      if (!keyNode) {
        continue;
      }

      elements.push(keyNode);

      if (!valueNode) {
        continue;
      }

      if (isSymbol(keyNode) && keyNode.name === "&") {
        if (isSymbol(valueNode) && valueNode.name !== "_") {
          const binding = createLocalBindingMeta(valueNode.name);
          elements.push(attachResolvedBindingMeta(valueNode, binding));
          bindings.push(binding);
        } else {
          elements.push(valueNode);
        }
        break;
      }

      const annotatedValue = annotateBindingTarget(valueNode);
      elements.push(annotatedValue.expr);
      bindings.push(...annotatedValue.bindings);
    }

    return {
      expr: createListFrom(target, elements),
      bindings,
    };
  }

  const rawElements = hasArrayLiteralPrefix(target)
    ? target.elements.slice(1)
    : target.elements;
  const processedElements: HQLNode[] = hasArrayLiteralPrefix(target)
    ? [target.elements[0]]
    : [];
  const bindings: ResolvedBindingMeta[] = [];

  for (let i = 0; i < rawElements.length; i++) {
    const element = rawElements[i];

    if (isSymbol(element) && element.name === "&") {
      processedElements.push(element);
      const restTarget = rawElements[i + 1];
      if (restTarget && isSymbol(restTarget) && restTarget.name !== "_") {
        const binding = createLocalBindingMeta(restTarget.name);
        processedElements.push(attachResolvedBindingMeta(restTarget, binding));
        bindings.push(binding);
      } else if (restTarget) {
        processedElements.push(restTarget);
      }
      i += 1;
      continue;
    }

    if (
      isList(element) &&
      (couldBePattern(element) || hasArrayLiteralPrefix(element) ||
        hasHashMapPrefix(element))
    ) {
      const annotated = annotateBindingTarget(element);
      processedElements.push(annotated.expr);
      bindings.push(...annotated.bindings);
      continue;
    }

    if (isSymbol(element) && element.name !== "_") {
      const binding = createLocalBindingMeta(element.name);
      processedElements.push(attachResolvedBindingMeta(element, binding));
      bindings.push(binding);
      continue;
    }

    processedElements.push(element);
  }

  return {
    expr: createListFrom(target, processedElements),
    bindings,
  };
}

function preprocessBindingTarget(
  target: HQLNode,
  depth: number,
  state: TemplateState,
): TemplateBindingTargetResult {
  return annotateBindingTarget(preprocessTemplateNode(target, depth, state));
}

function preprocessBindingForm(
  list: ListNode,
  depth: number,
  state: TemplateState,
): HQLNode {
  const processedHead = preprocessTemplateNode(list.elements[0], depth, state);
  if (list.elements.length < 2) {
    return createListFrom(list, [processedHead]);
  }

  const bindingTarget = list.elements[1];
  const scopeBindings = cloneResolvedBindingMap(state.templateBindings);

  if (isSymbol(bindingTarget)) {
    const processedValue = list.elements.length > 2
      ? preprocessTemplateNode(list.elements[2], depth, {
        ...state,
        templateBindings: scopeBindings,
      })
      : bindingTarget;

    const annotatedTarget = bindingTarget.name === "_"
      ? { expr: bindingTarget as HQLNode, bindings: [] }
      : preprocessBindingTarget(bindingTarget, depth, state);
    addResolvedBindings(scopeBindings, annotatedTarget.bindings);

    const processedElements: HQLNode[] = [
      processedHead,
      annotatedTarget.expr,
      processedValue,
    ];

    for (let i = 3; i < list.elements.length; i++) {
      processedElements.push(
        preprocessTemplateNode(list.elements[i], depth, {
          ...state,
          templateBindings: scopeBindings,
        }),
      );
    }

    return createListFrom(list, processedElements);
  }

  if (!isList(bindingTarget)) {
    return createListFrom(list, [
      processedHead,
      preprocessTemplateNode(bindingTarget, depth, state),
      ...list.elements.slice(2).map((element) =>
        preprocessTemplateNode(element, depth, state)
      ),
    ]);
  }

  const rawBindingElements = hasArrayLiteralPrefix(bindingTarget)
    ? bindingTarget.elements.slice(1)
    : bindingTarget.elements;
  const processedBindingElements: HQLNode[] =
    hasArrayLiteralPrefix(bindingTarget) ? [bindingTarget.elements[0]] : [];

  for (let i = 0; i < rawBindingElements.length; i += 2) {
    const target = rawBindingElements[i];
    const value = rawBindingElements[i + 1];
    if (!target) {
      continue;
    }

    const annotatedTarget = preprocessBindingTarget(target, depth, {
      ...state,
      templateBindings: scopeBindings,
    });
    processedBindingElements.push(annotatedTarget.expr);

    if (value) {
      processedBindingElements.push(
        preprocessTemplateNode(value, depth, {
          ...state,
          templateBindings: scopeBindings,
        }),
      );
    }

    addResolvedBindings(scopeBindings, annotatedTarget.bindings);
  }

  const processedElements: HQLNode[] = [
    processedHead,
    createListFrom(bindingTarget, processedBindingElements),
  ];

  for (let i = 2; i < list.elements.length; i++) {
    processedElements.push(
      preprocessTemplateNode(list.elements[i], depth, {
        ...state,
        templateBindings: scopeBindings,
      }),
    );
  }

  return createListFrom(list, processedElements);
}

function preprocessParams(
  paramsNode: ListNode,
  depth: number,
  state: TemplateState,
  scopeBindings: Map<string, ResolvedBindingMeta>,
): HQLNode {
  const rawParams = hasArrayLiteralPrefix(paramsNode)
    ? paramsNode.elements.slice(1)
    : paramsNode.elements;
  const processedParams: HQLNode[] = hasArrayLiteralPrefix(paramsNode)
    ? [paramsNode.elements[0]]
    : [];

  for (let i = 0; i < rawParams.length; i++) {
    const param = rawParams[i];

    if (isSymbol(param) && param.name === "&") {
      processedParams.push(param);
      const restParam = rawParams[i + 1];
      if (restParam) {
        const annotatedRest = preprocessBindingTarget(restParam, depth, {
          ...state,
          templateBindings: scopeBindings,
        });
        processedParams.push(annotatedRest.expr);
        addResolvedBindings(scopeBindings, annotatedRest.bindings);
      }
      i += 1;
      continue;
    }

    if (isSymbol(param) && param.name.startsWith("...")) {
      const annotatedRest = preprocessBindingTarget(param, depth, {
        ...state,
        templateBindings: scopeBindings,
      });
      processedParams.push(annotatedRest.expr);
      addResolvedBindings(scopeBindings, annotatedRest.bindings);
      continue;
    }

    if (
      isList(param) &&
      (couldBePattern(param) || hasArrayLiteralPrefix(param) ||
        hasHashMapPrefix(param))
    ) {
      const annotatedPattern = preprocessBindingTarget(param, depth, {
        ...state,
        templateBindings: scopeBindings,
      });
      processedParams.push(annotatedPattern.expr);
      addResolvedBindings(scopeBindings, annotatedPattern.bindings);
      continue;
    }

    if (isSymbol(param)) {
      const annotatedParam = preprocessBindingTarget(param, depth, {
        ...state,
        templateBindings: scopeBindings,
      });
      processedParams.push(annotatedParam.expr);
      addResolvedBindings(scopeBindings, annotatedParam.bindings);
      continue;
    }

    processedParams.push(param);
  }

  return createListFrom(paramsNode, processedParams);
}

function preprocessFunctionClause(
  clause: ListNode,
  depth: number,
  state: TemplateState,
  baseScopeBindings: Map<string, ResolvedBindingMeta>,
): HQLNode {
  if (clause.elements.length === 0 || !isList(clause.elements[0])) {
    return preprocessTemplateNode(clause, depth, {
      ...state,
      templateBindings: baseScopeBindings,
    });
  }

  const scopeBindings = cloneResolvedBindingMap(baseScopeBindings);
  const processedParams = preprocessParams(
    clause.elements[0] as ListNode,
    depth,
    state,
    scopeBindings,
  );
  const processedElements: HQLNode[] = [processedParams];

  for (let i = 1; i < clause.elements.length; i++) {
    processedElements.push(
      preprocessTemplateNode(clause.elements[i], depth, {
        ...state,
        templateBindings: scopeBindings,
      }),
    );
  }

  return createListFrom(clause, processedElements);
}

function looksLikeMultiArityFunction(
  list: ListNode,
  paramIndex: number,
): boolean {
  if (list.elements.length <= paramIndex) {
    return false;
  }

  return list.elements.slice(paramIndex).every((clause) =>
    isList(clause) &&
    clause.elements.length > 0 &&
    isList(clause.elements[0])
  );
}

function preprocessFunctionForm(
  list: ListNode,
  depth: number,
  state: TemplateState,
): HQLNode {
  const processedHead = preprocessTemplateNode(list.elements[0], depth, state);
  const scopeBindings = cloneResolvedBindingMap(state.templateBindings);
  const processedElements: HQLNode[] = [processedHead];
  let paramIndex = 1;

  if (
    list.elements.length > 1 &&
    isSymbol(list.elements[1]) &&
    list.elements.length > 2 &&
    isList(list.elements[2])
  ) {
    const annotatedName = preprocessBindingTarget(list.elements[1], depth, {
      ...state,
      templateBindings: scopeBindings,
    });
    processedElements.push(annotatedName.expr);
    addResolvedBindings(scopeBindings, annotatedName.bindings);
    paramIndex = 2;
  }

  if (looksLikeMultiArityFunction(list, paramIndex)) {
    for (let i = paramIndex; i < list.elements.length; i++) {
      processedElements.push(
        preprocessFunctionClause(
          list.elements[i] as ListNode,
          depth,
          state,
          scopeBindings,
        ),
      );
    }
    return createListFrom(list, processedElements);
  }

  if (
    list.elements.length <= paramIndex || !isList(list.elements[paramIndex])
  ) {
    return createListFrom(list, [
      ...processedElements,
      ...list.elements.slice(paramIndex).map((element) =>
        preprocessTemplateNode(element, depth, state)
      ),
    ]);
  }

  const bodyScopeBindings = cloneResolvedBindingMap(scopeBindings);
  processedElements.push(
    preprocessParams(
      list.elements[paramIndex] as ListNode,
      depth,
      state,
      bodyScopeBindings,
    ),
  );

  for (let i = paramIndex + 1; i < list.elements.length; i++) {
    processedElements.push(
      preprocessTemplateNode(list.elements[i], depth, {
        ...state,
        templateBindings: bodyScopeBindings,
      }),
    );
  }

  return createListFrom(list, processedElements);
}

function preprocessForOfForm(
  list: ListNode,
  depth: number,
  state: TemplateState,
): HQLNode {
  const processedHead = preprocessTemplateNode(list.elements[0], depth, state);
  if (list.elements.length < 2 || !isList(list.elements[1])) {
    return createListFrom(list, [
      processedHead,
      ...list.elements.slice(1).map((element) =>
        preprocessTemplateNode(element, depth, state)
      ),
    ]);
  }

  const bindingList = list.elements[1] as ListNode;
  const rawElements = hasArrayLiteralPrefix(bindingList)
    ? bindingList.elements.slice(1)
    : bindingList.elements;
  if (rawElements.length < 2) {
    return createListFrom(list, [
      processedHead,
      preprocessTemplateNode(bindingList, depth, state),
      ...list.elements.slice(2).map((element) =>
        preprocessTemplateNode(element, depth, state)
      ),
    ]);
  }

  const scopeBindings = cloneResolvedBindingMap(state.templateBindings);
  const annotatedTarget = preprocessBindingTarget(rawElements[0], depth, state);
  addResolvedBindings(scopeBindings, annotatedTarget.bindings);

  const processedBindingElements: HQLNode[] = hasArrayLiteralPrefix(bindingList)
    ? [bindingList.elements[0]]
    : [];
  processedBindingElements.push(annotatedTarget.expr);
  processedBindingElements.push(
    preprocessTemplateNode(rawElements[1], depth, state),
  );

  for (let i = 2; i < rawElements.length; i++) {
    processedBindingElements.push(
      preprocessTemplateNode(rawElements[i], depth, state),
    );
  }

  const processedElements: HQLNode[] = [
    processedHead,
    createListFrom(bindingList, processedBindingElements),
  ];

  for (let i = 2; i < list.elements.length; i++) {
    processedElements.push(
      preprocessTemplateNode(list.elements[i], depth, {
        ...state,
        templateBindings: scopeBindings,
      }),
    );
  }

  return createListFrom(list, processedElements);
}

function preprocessCatchForm(
  list: ListNode,
  depth: number,
  state: TemplateState,
): HQLNode {
  const processedHead = preprocessTemplateNode(list.elements[0], depth, state);
  if (list.elements.length < 2) {
    return createListFrom(list, [processedHead]);
  }

  const scopeBindings = cloneResolvedBindingMap(state.templateBindings);
  const processedElements: HQLNode[] = [processedHead];
  const binder = list.elements[1];

  if (isSymbol(binder)) {
    const annotatedBinder = preprocessBindingTarget(binder, depth, state);
    processedElements.push(annotatedBinder.expr);
    addResolvedBindings(scopeBindings, annotatedBinder.bindings);
  } else {
    processedElements.push(preprocessTemplateNode(binder, depth, state));
  }

  for (let i = 2; i < list.elements.length; i++) {
    processedElements.push(
      preprocessTemplateNode(list.elements[i], depth, {
        ...state,
        templateBindings: scopeBindings,
      }),
    );
  }

  return createListFrom(list, processedElements);
}

function preprocessSyntaxQuotedList(
  list: ListNode,
  depth: number,
  state: TemplateState,
): HQLNode | null {
  if (
    depth !== 0 ||
    state.quoteKind !== "syntax-quote" ||
    list.elements.length === 0 ||
    !isSymbol(list.elements[0])
  ) {
    return null;
  }

  switch (list.elements[0].name) {
    case "let":
    case "var":
    case "const":
    case "loop":
      return preprocessBindingForm(list, depth, state);
    case "fn":
    case "function":
    case "defn":
    case "fx":
      return preprocessFunctionForm(list, depth, state);
    case "for-of":
    case "for-await-of":
      return preprocessForOfForm(list, depth, state);
    case "catch":
      return preprocessCatchForm(list, depth, state);
    default:
      return null;
  }
}

function preprocessTemplateNode(
  node: HQLNode,
  depth: number,
  state: TemplateState,
): HQLNode {
  state.currentFile = getNodeFilePath(node, state.currentFile);

  if (isSymbol(node)) {
    return preprocessSymbol(node, depth, state);
  }

  if (!isList(node)) {
    return node;
  }

  if (node.elements.length === 0) {
    return node;
  }

  const first = node.elements[0];
  if (
    isSymbol(first) &&
    (first.name === "quasiquote" || first.name === "syntax-quote")
  ) {
    if (node.elements.length !== 2) {
      throw syntaxError(
        first.name,
        `${first.name} requires exactly one argument`,
        extractPosition(node),
      );
    }

    const nestedState: TemplateState = {
      quoteKind: first.name,
      autoGensymMap: new Map(),
      templateBindings: cloneResolvedBindingMap(state.templateBindings),
      currentFile: getNodeFilePath(node, state.currentFile),
    };

    return createListFrom(node, [
      createSymbol(first.name),
      preprocessTemplateNode(node.elements[1], depth + 1, nestedState),
    ]);
  }

  if (isSymbol(first) && first.name === "unquote") {
    if (node.elements.length !== 2) {
      throw syntaxError(
        "unquote",
        "unquote requires exactly one argument",
        extractPosition(node),
      );
    }

    if (depth === 0) {
      return node;
    }

    return createListFrom(node, [
      createSymbol("unquote"),
      preprocessTemplateNode(node.elements[1], depth - 1, state),
    ]);
  }

  if (isSymbol(first) && first.name === "unquote-splicing") {
    if (node.elements.length !== 2) {
      throw syntaxError(
        "unquote-splicing",
        "unquote-splicing requires exactly one argument",
        extractPosition(node),
      );
    }

    if (depth === 0) {
      return node;
    }

    return createListFrom(node, [
      createSymbol("unquote-splicing"),
      preprocessTemplateNode(node.elements[1], depth - 1, state),
    ]);
  }

  const specialized = preprocessSyntaxQuotedList(node, depth, state);
  if (specialized) {
    return specialized;
  }

  return createListFrom(
    node,
    node.elements.map((element) =>
      preprocessTemplateNode(element, depth, state)
    ),
  );
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
): IR.IRNode {
  validateListLength(list, 2, "quasiquote");

  const processed = preprocessTemplateNode(list.elements[1], 0, {
    quoteKind: "quasiquote",
    autoGensymMap: new Map(),
    templateBindings: new Map(),
    currentFile: getNodeFilePath(list, undefined),
  });
  const result = buildTemplateQuoteIR(processed, 0, currentDir, transformNode);
  copyPosition(list, result);
  return result;
}

export function transformSyntaxQuote(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRNode {
  validateListLength(list, 2, "syntax-quote");

  const processed = preprocessTemplateNode(list.elements[1], 0, {
    quoteKind: "syntax-quote",
    autoGensymMap: new Map(),
    templateBindings: new Map(),
    currentFile: getNodeFilePath(list, undefined),
  });
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
