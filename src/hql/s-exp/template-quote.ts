import {
  addResolvedBindings,
  attachResolvedBindingMeta,
  cloneResolvedBindingMap,
  createListFrom,
  createSymbol,
  getMeta,
  isForm,
  isList,
  isSymbol,
  type ResolvedBindingMeta,
  type SExp,
  type SList,
  type SSymbol,
} from "./types.ts";
import { couldBePattern } from "./pattern-parser.ts";
import {
  hasArrayLiteralPrefix,
  hasHashMapPrefix,
} from "../../common/sexp-utils.ts";

export type TemplateQuoteKind = "quote" | "quasiquote" | "syntax-quote";
export type TemplateQuoteMode = "preserve" | "evaluate";

export interface TemplateQuoteContext {
  currentFile?: string;
  mode: TemplateQuoteMode;
  fail(formName: string, message: string, node: SExp): never;
  resolveNonLocalBinding(
    symbol: SSymbol,
    currentFile?: string,
  ): ResolvedBindingMeta | undefined;
  createLocalBinding(name: string): ResolvedBindingMeta;
  createAutoGensym(baseName: string): SSymbol;
  evaluateUnquote?(expr: SExp): SExp;
  spliceValueToElements?(value: SExp): SExp[];
}

interface TemplateState {
  quoteKind: Exclude<TemplateQuoteKind, "quote">;
  autoGensymMap: Map<string, SSymbol>;
  templateBindings: Map<string, ResolvedBindingMeta>;
  currentFile?: string;
}

interface TemplateBindingTargetResult {
  expr: SExp;
  bindings: ResolvedBindingMeta[];
}

interface VectorLikeElements {
  prefix: SExp[];
  rawElements: SExp[];
}

export function processTemplateQuote(
  expr: SExp,
  kind: TemplateQuoteKind,
  context: TemplateQuoteContext,
): SExp {
  if (kind === "quote") {
    return expr;
  }

  return processTemplateNode(
    expr,
    0,
    {
      quoteKind: kind,
      autoGensymMap: new Map(),
      templateBindings: new Map(),
      currentFile: context.currentFile ?? getMeta(expr)?.filePath,
    },
    context,
  );
}

function processTemplateNode(
  node: SExp,
  depth: number,
  state: TemplateState,
  context: TemplateQuoteContext,
): SExp {
  state.currentFile = getMeta(node)?.filePath ?? state.currentFile;

  if (isSymbol(node)) {
    return processTemplateSymbol(node, depth, state, context);
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
      context.fail(first.name, `${first.name} requires exactly one argument`, node);
    }

    const nestedState: TemplateState = {
      quoteKind: first.name,
      autoGensymMap: new Map(),
      templateBindings: cloneResolvedBindingMap(state.templateBindings),
      currentFile: getMeta(node)?.filePath ?? state.currentFile,
    };

    return createListFrom(node, [
      createSymbol(first.name),
      processTemplateNode(node.elements[1], depth + 1, nestedState, context),
    ]);
  }

  if (isSymbol(first) && first.name === "unquote") {
    if (node.elements.length !== 2) {
      context.fail("unquote", "unquote requires exactly one argument", node);
    }

    if (depth === 0) {
      if (context.mode === "preserve") {
        return node;
      }
      if (!context.evaluateUnquote) {
        context.fail("unquote", "template quote evaluation is unavailable", node);
      }
      return context.evaluateUnquote(node.elements[1]);
    }

    return createListFrom(node, [
      createSymbol("unquote"),
      processTemplateNode(node.elements[1], depth - 1, state, context),
    ]);
  }

  if (isSymbol(first) && first.name === "unquote-splicing") {
    if (node.elements.length !== 2) {
      context.fail(
        "unquote-splicing",
        "unquote-splicing requires exactly one argument",
        node,
      );
    }

    if (depth === 0) {
      if (context.mode === "preserve") {
        return node;
      }
      context.fail("unquote-splicing", "unquote-splicing not in list context", node);
    }

    return createListFrom(node, [
      createSymbol("unquote-splicing"),
      processTemplateNode(node.elements[1], depth - 1, state, context),
    ]);
  }

  const specialized = processSyntaxQuotedSpecialForm(node, depth, state, context);
  if (specialized) {
    return specialized;
  }

  return createListFrom(
    node,
    processListContextElements(node.elements, depth, state, context),
  );
}

function processTemplateSymbol(
  symbol: SSymbol,
  depth: number,
  state: TemplateState,
  context: TemplateQuoteContext,
): SExp {
  if (depth === 0 && symbol.name.endsWith("#")) {
    const existing = state.autoGensymMap.get(symbol.name);
    if (existing) {
      return existing;
    }

    const generated = context.createAutoGensym(symbol.name.slice(0, -1));
    state.autoGensymMap.set(symbol.name, generated);
    return generated;
  }

  if (state.quoteKind !== "syntax-quote" || depth !== 0) {
    return symbol;
  }

  const templateBinding = state.templateBindings.get(symbol.name);
  if (templateBinding) {
    return attachResolvedBindingMeta(symbol, templateBinding);
  }

  const resolvedBinding = context.resolveNonLocalBinding(symbol, state.currentFile);
  return resolvedBinding
    ? attachResolvedBindingMeta(symbol, resolvedBinding)
    : symbol;
}

function splitVectorLikeElements(list: SList): VectorLikeElements {
  return hasArrayLiteralPrefix(list)
    ? {
      prefix: [list.elements[0]],
      rawElements: list.elements.slice(1),
    }
    : {
      prefix: [],
      rawElements: list.elements,
    };
}

function processListContextElements(
  elements: SExp[],
  depth: number,
  state: TemplateState,
  context: TemplateQuoteContext,
): SExp[] {
  const processedElements: SExp[] = [];

  for (const element of elements) {
    if (
      context.mode === "evaluate" &&
      depth === 0 &&
      isForm(element, "unquote-splicing")
    ) {
      const spliceList = element as SList;
      if (spliceList.elements.length !== 2) {
        context.fail(
          "unquote-splicing",
          "unquote-splicing requires exactly one argument",
          element,
        );
      }
      if (!context.evaluateUnquote || !context.spliceValueToElements) {
        context.fail(
          "unquote-splicing",
          "template quote splicing is unavailable",
          element,
        );
      }
      const value = context.evaluateUnquote(spliceList.elements[1]);
      processedElements.push(...context.spliceValueToElements(value));
      continue;
    }

    processedElements.push(processTemplateNode(element, depth, state, context));
  }

  return processedElements;
}

function processSyntaxQuotedSpecialForm(
  list: SList,
  depth: number,
  state: TemplateState,
  context: TemplateQuoteContext,
): SExp | null {
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
      return processBindingForm(list, depth, state, context);
    case "fn":
    case "function":
    case "defn":
    case "fx":
      return processFunctionForm(list, depth, state, context);
    case "for-of":
    case "for-await-of":
      return processForOfForm(list, depth, state, context);
    case "catch":
      return processCatchForm(list, depth, state, context);
    default:
      return null;
  }
}

function processBindingTarget(
  target: SExp,
  depth: number,
  state: TemplateState,
  context: TemplateQuoteContext,
): TemplateBindingTargetResult {
  return annotateBindingTarget(
    processTemplateNode(target, depth, state, context),
    context,
  );
}

function annotateBindingTarget(
  target: SExp,
  context: TemplateQuoteContext,
): TemplateBindingTargetResult {
  if (isSymbol(target)) {
    if (target.name === "_") {
      return { expr: target, bindings: [] };
    }

    const binding = context.createLocalBinding(target.name);
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
    const elements: SExp[] = [target.elements[0]];

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
          const binding = context.createLocalBinding(valueNode.name);
          elements.push(attachResolvedBindingMeta(valueNode, binding));
          bindings.push(binding);
        } else {
          elements.push(valueNode);
        }
        break;
      }

      const annotatedValue = annotateBindingTarget(valueNode, context);
      elements.push(annotatedValue.expr);
      bindings.push(...annotatedValue.bindings);
    }

    return {
      expr: createListFrom(target, elements),
      bindings,
    };
  }

  const { prefix, rawElements } = splitVectorLikeElements(target);
  const processedElements: SExp[] = [...prefix];
  const bindings: ResolvedBindingMeta[] = [];

  for (let i = 0; i < rawElements.length; i++) {
    const element = rawElements[i];

    if (isSymbol(element) && element.name === "&") {
      processedElements.push(element);
      const restTarget = rawElements[i + 1];
      if (restTarget && isSymbol(restTarget) && restTarget.name !== "_") {
        const binding = context.createLocalBinding(restTarget.name);
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
      const annotated = annotateBindingTarget(element, context);
      processedElements.push(annotated.expr);
      bindings.push(...annotated.bindings);
      continue;
    }

    if (isSymbol(element) && element.name !== "_") {
      const binding = context.createLocalBinding(element.name);
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

function processBindingForm(
  list: SList,
  depth: number,
  state: TemplateState,
  context: TemplateQuoteContext,
): SExp {
  const processedHead = processTemplateNode(list.elements[0], depth, state, context);
  if (list.elements.length < 2) {
    return createListFrom(list, [processedHead]);
  }

  const bindingTarget = list.elements[1];
  const scopeBindings = cloneResolvedBindingMap(state.templateBindings);

  if (isSymbol(bindingTarget)) {
    const processedValue = list.elements.length > 2
      ? processTemplateNode(list.elements[2], depth, {
        ...state,
        templateBindings: scopeBindings,
      }, context)
      : bindingTarget;

    const annotatedTarget = bindingTarget.name === "_"
      ? { expr: bindingTarget as SExp, bindings: [] }
      : processBindingTarget(bindingTarget, depth, state, context);
    addResolvedBindings(scopeBindings, annotatedTarget.bindings);

    const processedElements: SExp[] = [
      processedHead,
      annotatedTarget.expr,
      processedValue,
      ...processListContextElements(
        list.elements.slice(3),
        depth,
        {
          ...state,
          templateBindings: scopeBindings,
        },
        context,
      ),
    ];

    return createListFrom(list, processedElements);
  }

  if (!isList(bindingTarget)) {
    return createListFrom(list, [
      processedHead,
      processTemplateNode(bindingTarget, depth, state, context),
      ...processListContextElements(list.elements.slice(2), depth, state, context),
    ]);
  }

  const {
    prefix: bindingPrefix,
    rawElements: rawBindingElements,
  } = splitVectorLikeElements(bindingTarget);
  const processedBindingElements: SExp[] = [...bindingPrefix];

  for (let i = 0; i < rawBindingElements.length; i += 2) {
    const target = rawBindingElements[i];
    const value = rawBindingElements[i + 1];
    if (!target) {
      continue;
    }

    const annotatedTarget = processBindingTarget(
      target,
      depth,
      {
        ...state,
        templateBindings: scopeBindings,
      },
      context,
    );
    processedBindingElements.push(annotatedTarget.expr);

    if (value) {
      processedBindingElements.push(
        processTemplateNode(value, depth, {
          ...state,
          templateBindings: scopeBindings,
        }, context),
      );
    }

    addResolvedBindings(scopeBindings, annotatedTarget.bindings);
  }

  return createListFrom(list, [
    processedHead,
    createListFrom(bindingTarget, processedBindingElements),
    ...processListContextElements(
      list.elements.slice(2),
      depth,
      {
        ...state,
        templateBindings: scopeBindings,
      },
      context,
    ),
  ]);
}

function processParams(
  paramsNode: SList,
  depth: number,
  state: TemplateState,
  scopeBindings: Map<string, ResolvedBindingMeta>,
  context: TemplateQuoteContext,
): SExp {
  const { prefix, rawElements: rawParams } = splitVectorLikeElements(paramsNode);
  const processedParams: SExp[] = [...prefix];

  for (let i = 0; i < rawParams.length; i++) {
    const param = rawParams[i];

    if (isSymbol(param) && param.name === "&") {
      processedParams.push(param);
      const restParam = rawParams[i + 1];
      if (restParam) {
        const annotatedRest = processBindingTarget(restParam, depth, {
          ...state,
          templateBindings: scopeBindings,
        }, context);
        processedParams.push(annotatedRest.expr);
        addResolvedBindings(scopeBindings, annotatedRest.bindings);
      }
      i += 1;
      continue;
    }

    if (isSymbol(param) && param.name.startsWith("...")) {
      const annotatedRest = processBindingTarget(param, depth, {
        ...state,
        templateBindings: scopeBindings,
      }, context);
      processedParams.push(annotatedRest.expr);
      addResolvedBindings(scopeBindings, annotatedRest.bindings);
      continue;
    }

    if (
      isList(param) &&
      (couldBePattern(param) || hasArrayLiteralPrefix(param) ||
        hasHashMapPrefix(param))
    ) {
      const annotatedPattern = processBindingTarget(param, depth, {
        ...state,
        templateBindings: scopeBindings,
      }, context);
      processedParams.push(annotatedPattern.expr);
      addResolvedBindings(scopeBindings, annotatedPattern.bindings);
      continue;
    }

    if (isSymbol(param)) {
      const annotatedParam = processBindingTarget(param, depth, {
        ...state,
        templateBindings: scopeBindings,
      }, context);
      processedParams.push(annotatedParam.expr);
      addResolvedBindings(scopeBindings, annotatedParam.bindings);
      continue;
    }

    processedParams.push(param);
  }

  return createListFrom(paramsNode, processedParams);
}

function looksLikeMultiArityFunction(
  list: SList,
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

function processFunctionClause(
  clause: SList,
  depth: number,
  state: TemplateState,
  baseScopeBindings: Map<string, ResolvedBindingMeta>,
  context: TemplateQuoteContext,
): SExp {
  if (clause.elements.length === 0 || !isList(clause.elements[0])) {
    return processTemplateNode(clause, depth, {
      ...state,
      templateBindings: baseScopeBindings,
    }, context);
  }

  const scopeBindings = cloneResolvedBindingMap(baseScopeBindings);
  const processedParams = processParams(
    clause.elements[0] as SList,
    depth,
    state,
    scopeBindings,
    context,
  );

  return createListFrom(clause, [
    processedParams,
    ...processListContextElements(
      clause.elements.slice(1),
      depth,
      {
        ...state,
        templateBindings: scopeBindings,
      },
      context,
    ),
  ]);
}

function processFunctionForm(
  list: SList,
  depth: number,
  state: TemplateState,
  context: TemplateQuoteContext,
): SExp {
  const processedHead = processTemplateNode(list.elements[0], depth, state, context);
  const scopeBindings = cloneResolvedBindingMap(state.templateBindings);
  const processedElements: SExp[] = [processedHead];
  let paramIndex = 1;

  if (
    list.elements.length > 1 &&
    isSymbol(list.elements[1]) &&
    list.elements.length > 2 &&
    isList(list.elements[2])
  ) {
    const annotatedName = processBindingTarget(list.elements[1], depth, {
      ...state,
      templateBindings: scopeBindings,
    }, context);
    processedElements.push(annotatedName.expr);
    addResolvedBindings(scopeBindings, annotatedName.bindings);
    paramIndex = 2;
  }

  if (looksLikeMultiArityFunction(list, paramIndex)) {
    return createListFrom(list, [
      ...processedElements,
      ...list.elements.slice(paramIndex).map((clause) =>
        processFunctionClause(
          clause as SList,
          depth,
          state,
          scopeBindings,
          context,
        )
      ),
    ]);
  }

  if (list.elements.length <= paramIndex || !isList(list.elements[paramIndex])) {
    return createListFrom(list, [
      ...processedElements,
      ...processListContextElements(list.elements.slice(paramIndex), depth, state, context),
    ]);
  }

  const bodyScopeBindings = cloneResolvedBindingMap(scopeBindings);
  processedElements.push(
    processParams(
      list.elements[paramIndex] as SList,
      depth,
      state,
      bodyScopeBindings,
      context,
    ),
  );

  return createListFrom(list, [
    ...processedElements,
    ...processListContextElements(
      list.elements.slice(paramIndex + 1),
      depth,
      {
        ...state,
        templateBindings: bodyScopeBindings,
      },
      context,
    ),
  ]);
}

function processForOfForm(
  list: SList,
  depth: number,
  state: TemplateState,
  context: TemplateQuoteContext,
): SExp {
  const processedHead = processTemplateNode(list.elements[0], depth, state, context);
  if (list.elements.length < 3) {
    return createListFrom(list, [
      processedHead,
      ...processListContextElements(list.elements.slice(1), depth, state, context),
    ]);
  }

  const bindingVector = list.elements[1];
  if (!isList(bindingVector)) {
    return createListFrom(list, [
      processedHead,
      processTemplateNode(bindingVector, depth, state, context),
      ...processListContextElements(list.elements.slice(2), depth, state, context),
    ]);
  }

  const {
    prefix,
    rawElements,
  } = splitVectorLikeElements(bindingVector);
  if (rawElements.length !== 2) {
    return createListFrom(list, [
      processedHead,
      processTemplateNode(bindingVector, depth, state, context),
      ...processListContextElements(list.elements.slice(2), depth, state, context),
    ]);
  }

  const binder = rawElements[0];
  const iterable = rawElements[1];
  const scopeBindings = cloneResolvedBindingMap(state.templateBindings);
  const annotatedTarget = processBindingTarget(binder, depth, state, context);
  addResolvedBindings(scopeBindings, annotatedTarget.bindings);

  const processedIterable = processTemplateNode(iterable, depth, {
    ...state,
    templateBindings: scopeBindings,
  }, context);

  return createListFrom(list, [
    processedHead,
    createListFrom(bindingVector, [
      ...prefix,
      annotatedTarget.expr,
      processedIterable,
    ]),
    ...processListContextElements(
      list.elements.slice(2),
      depth,
      {
        ...state,
        templateBindings: scopeBindings,
      },
      context,
    ),
  ]);
}

function processCatchForm(
  list: SList,
  depth: number,
  state: TemplateState,
  context: TemplateQuoteContext,
): SExp {
  const processedHead = processTemplateNode(list.elements[0], depth, state, context);
  if (list.elements.length < 2) {
    return createListFrom(list, [processedHead]);
  }

  const binder = list.elements[1];
  const scopeBindings = cloneResolvedBindingMap(state.templateBindings);
  const processedElements: SExp[] = [processedHead];

  if (isSymbol(binder) || isList(binder)) {
    const annotatedBinder = processBindingTarget(binder, depth, state, context);
    processedElements.push(annotatedBinder.expr);
    addResolvedBindings(scopeBindings, annotatedBinder.bindings);
  } else {
    processedElements.push(processTemplateNode(binder, depth, state, context));
  }

  processedElements.push(
    ...processListContextElements(
      list.elements.slice(2),
      depth,
      {
        ...state,
        templateBindings: scopeBindings,
      },
      context,
    ),
  );

  return createListFrom(list, processedElements);
}
