import type * as IR from "../type/hql_ir.ts";
import type { SymbolNode } from "../type/hql_ast.ts";
import {
  getMeta,
  type ResolvedBindingMeta,
  type SExpMeta,
} from "../../s-exp/types.ts";
import { ValidationError } from "../../../common/error.ts";
import { sanitizeIdentifier } from "../../../common/utils.ts";
import {
  globalSymbolTable,
  type SymbolInfo,
  type SymbolTable,
} from "../symbol_table.ts";
import { createId } from "./ir-helpers.ts";

export interface LexicalBindingRecord {
  sourceName: string;
  jsName: string;
  bindingIdentity?: string;
}

interface LexicalScope {
  bindingsByName: Map<string, LexicalBindingRecord>;
  bindingsByIdentity: Map<string, LexicalBindingRecord>;
}

interface BindingCarrier {
  name: string;
  _meta?: SExpMeta;
}

let currentSymbolTable: SymbolTable = globalSymbolTable;
let lexicalScopes: LexicalScope[] = [createLexicalScope()];

function createLexicalScope(): LexicalScope {
  return {
    bindingsByName: new Map(),
    bindingsByIdentity: new Map(),
  };
}

function getCurrentScope(): LexicalScope {
  if (lexicalScopes.length === 0) {
    lexicalScopes = [createLexicalScope()];
  }
  return lexicalScopes[lexicalScopes.length - 1];
}

function normalizeBindingIdentitySegment(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_]+/g, "_").replace(
    /^_+|_+$/g,
    "",
  );
  return normalized.length > 0 ? normalized : "binding";
}

export function localBindingIdentity(lexicalId: string): string {
  return `local::${lexicalId}`;
}

export function moduleBindingIdentity(
  modulePath: string,
  exportName: string,
): string {
  return `${modulePath}::${exportName}`;
}

export function resolvedBindingIdentity(
  binding: ResolvedBindingMeta | undefined,
): string | undefined {
  if (!binding) {
    return undefined;
  }

  if (binding.kind === "local") {
    return binding.lexicalId
      ? localBindingIdentity(binding.lexicalId)
      : undefined;
  }

  return binding.modulePath
    ? moduleBindingIdentity(binding.modulePath, binding.exportName)
    : undefined;
}

export function buildBoundIdentifierName(
  sourceName: string,
  bindingIdentity: string,
): string {
  const baseName = sanitizeIdentifier(sourceName);
  const suffix = normalizeBindingIdentitySegment(bindingIdentity);
  return sanitizeIdentifier(`${baseName}__${suffix}`);
}

export function initializeBindingResolution(symbolTable: SymbolTable): void {
  currentSymbolTable = symbolTable;
  lexicalScopes = [createLexicalScope()];
}

export function pushLexicalScope(): void {
  lexicalScopes.push(createLexicalScope());
}

export function popLexicalScope(): void {
  if (lexicalScopes.length > 1) {
    lexicalScopes.pop();
  }
}

export function withLexicalScope<T>(fn: () => T): T {
  pushLexicalScope();
  try {
    return fn();
  } finally {
    popLexicalScope();
  }
}

function findLexicalBindingByName(
  name: string,
): LexicalBindingRecord | undefined {
  for (let i = lexicalScopes.length - 1; i >= 0; i--) {
    const binding = lexicalScopes[i].bindingsByName.get(name);
    if (binding) {
      return binding;
    }
  }
  return undefined;
}

function findLexicalBindingByIdentity(
  bindingIdentity: string,
): LexicalBindingRecord | undefined {
  for (let i = lexicalScopes.length - 1; i >= 0; i--) {
    const binding = lexicalScopes[i].bindingsByIdentity.get(bindingIdentity);
    if (binding) {
      return binding;
    }
  }
  return undefined;
}

function registerLexicalBindingRecord(
  record: LexicalBindingRecord,
): LexicalBindingRecord {
  const scope = getCurrentScope();
  scope.bindingsByName.set(record.sourceName, record);
  if (record.bindingIdentity) {
    scope.bindingsByIdentity.set(record.bindingIdentity, record);
  }
  return record;
}

function createLexicalBindingRecord(
  name: string,
  meta?: ResolvedBindingMeta,
): LexicalBindingRecord {
  const bindingIdentity = resolvedBindingIdentity(meta);
  const jsName = bindingIdentity
    ? buildBoundIdentifierName(name, bindingIdentity)
    : sanitizeIdentifier(name);

  return {
    sourceName: name,
    jsName,
    bindingIdentity,
  };
}

export function registerLexicalBinding(
  name: string,
  meta?: ResolvedBindingMeta,
): LexicalBindingRecord {
  return registerLexicalBindingRecord(createLexicalBindingRecord(name, meta));
}

export function registerDeclaredBinding(
  name: string,
  originalName: string = name,
  meta?: ResolvedBindingMeta,
): LexicalBindingRecord {
  if (meta) {
    return registerLexicalBinding(name, meta);
  }

  if (lexicalScopes.length === 1) {
    const symbolInfo = lookupSymbolInfoByName(originalName);
    if (symbolInfo?.bindingIdentity || symbolInfo?.jsName) {
      return registerLexicalBindingRecord({
        sourceName: name,
        jsName: symbolInfo.jsName ??
          buildBoundIdentifierName(
            name,
            symbolInfo.bindingIdentity ??
              moduleBindingIdentity("<unknown-module>", name),
          ),
        bindingIdentity: symbolInfo.bindingIdentity,
      });
    }
  }

  return registerLexicalBinding(name, undefined);
}

export function registerBindingAlias(
  name: string,
  bindingIdentity?: string,
  jsName?: string,
): LexicalBindingRecord {
  return registerLexicalBindingRecord({
    sourceName: name,
    jsName: jsName ??
      (bindingIdentity
        ? buildBoundIdentifierName(name, bindingIdentity)
        : sanitizeIdentifier(name)),
    bindingIdentity,
  });
}

export function registerBindingCarrier(
  carrier: BindingCarrier,
): LexicalBindingRecord {
  return registerLexicalBinding(carrier.name, carrier._meta?.resolvedBinding);
}

export function identifierFromBindingCarrier(
  carrier: BindingCarrier,
): IR.IRIdentifier {
  const record = registerBindingCarrier(carrier);
  return createId(record.jsName, {
    originalName: carrier.name,
    bindingIdentity: record.bindingIdentity,
  });
}

export function identifierFromBindingRecord(
  record: LexicalBindingRecord,
  originalName?: string,
): IR.IRIdentifier {
  return createId(record.jsName, {
    originalName: originalName ?? record.sourceName,
    bindingIdentity: record.bindingIdentity,
  });
}

function lookupSymbolInfoByBindingIdentity(
  bindingIdentity: string,
): SymbolInfo | undefined {
  return currentSymbolTable.getByBindingIdentity(bindingIdentity) ??
    globalSymbolTable.getByBindingIdentity(bindingIdentity);
}

function lookupSymbolInfoByName(name: string): SymbolInfo | undefined {
  return currentSymbolTable.get(name) ?? globalSymbolTable.get(name);
}

export function lookupResolvedSymbolInfo(
  symbol: BindingCarrier,
): SymbolInfo | undefined {
  const resolvedBinding = symbol._meta?.resolvedBinding;
  const bindingIdentity = resolvedBindingIdentity(resolvedBinding);

  if (
    resolvedBinding?.kind === "module" && bindingIdentity &&
    resolvedBinding.modulePath !== "<special-form>" &&
    resolvedBinding.modulePath !== "<builtin>"
  ) {
    return lookupSymbolInfoByBindingIdentity(bindingIdentity);
  }

  return lookupSymbolInfoByName(symbol.name);
}

function identifierFromSymbolInfo(
  originalName: string,
  symbolInfo: SymbolInfo,
  fallbackBindingIdentity?: string,
): IR.IRIdentifier {
  return createId(symbolInfo.jsName ?? sanitizeIdentifier(symbolInfo.name), {
    originalName,
    bindingIdentity: fallbackBindingIdentity ?? symbolInfo.bindingIdentity,
  });
}

export function identifierFromRegisteredName(name: string): IR.IRIdentifier {
  const symbolInfo = lookupSymbolInfoByName(name);
  if (!symbolInfo) {
    return createId(sanitizeIdentifier(name), {
      originalName: name,
    });
  }

  return identifierFromSymbolInfo(
    name,
    {
      ...symbolInfo,
      jsName: symbolInfo.jsName ??
        (symbolInfo.bindingIdentity
          ? buildBoundIdentifierName(
            symbolInfo.name,
            symbolInfo.bindingIdentity,
          )
          : undefined),
    },
    symbolInfo.bindingIdentity,
  );
}

export function resolveSymbolIdentifier(symbol: SymbolNode): IR.IRIdentifier {
  const meta = getMeta(symbol);
  const resolvedBinding = meta?.resolvedBinding;
  const bindingIdentity = resolvedBindingIdentity(resolvedBinding);

  if (resolvedBinding && bindingIdentity) {
    if (resolvedBinding.kind === "local") {
      const lexicalBinding = findLexicalBindingByIdentity(bindingIdentity);
      if (!lexicalBinding) {
        throw new ValidationError(
          `Resolved local binding '${symbol.name}' is no longer in scope`,
          "identifier resolution",
        );
      }
      return identifierFromBindingRecord(lexicalBinding, symbol.name);
    }

    if (
      resolvedBinding.modulePath === "<special-form>" ||
      resolvedBinding.modulePath === "<builtin>"
    ) {
      return createId(sanitizeIdentifier(resolvedBinding.exportName), {
        originalName: symbol.name,
        bindingIdentity,
      });
    }

    const target = lookupSymbolInfoByBindingIdentity(bindingIdentity);
    if (!target) {
      throw new ValidationError(
        `Resolved module binding '${resolvedBinding.exportName}' from '${resolvedBinding.modulePath}' could not be found`,
        "identifier resolution",
      );
    }
    return identifierFromSymbolInfo(symbol.name, target, bindingIdentity);
  }

  const lexicalBinding = findLexicalBindingByName(symbol.name);
  if (lexicalBinding) {
    return identifierFromBindingRecord(lexicalBinding, symbol.name);
  }

  const symbolInfo = lookupResolvedSymbolInfo(symbol);
  if (symbolInfo?.jsName || symbolInfo?.bindingIdentity) {
    return identifierFromSymbolInfo(
      symbol.name,
      {
        ...symbolInfo,
        jsName: symbolInfo.jsName ??
          (symbolInfo.bindingIdentity
            ? buildBoundIdentifierName(
              symbolInfo.name,
              symbolInfo.bindingIdentity,
            )
            : undefined),
      },
      symbolInfo.bindingIdentity,
    );
  }

  return createId(sanitizeIdentifier(symbol.name), {
    originalName: symbol.name,
  });
}
