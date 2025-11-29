/**
 * TypeScript Declaration File Generator
 *
 * Generates .d.ts files from HQL IR to provide basic TypeScript support
 * for HQL modules imported from TypeScript.
 */

import * as IR from "./type/hql_ir.ts";

interface MethodInfo {
  name: string;
  params: string[];
}

interface ClassInfo {
  constructorParams: string[];
  methods: MethodInfo[];
}

interface ExportInfo {
  name: string;
  kind: "function" | "variable" | "class" | "default";
  params?: string[];
  isAsync?: boolean;
  classInfo?: ClassInfo;
}

/**
 * Extract export information from an IR program
 */
function extractExports(program: IR.IRProgram): ExportInfo[] {
  const exports: ExportInfo[] = [];
  const definedFunctions = new Map<string, { params: string[]; isAsync: boolean }>();
  const definedVariables = new Set<string>();
  const definedClasses = new Map<string, ClassInfo>();

  // First pass: collect all function, variable, and class definitions
  for (const node of program.body) {
    if (node.type === IR.IRNodeType.FnFunctionDeclaration) {
      const fn = node as IR.IRFnFunctionDeclaration;
      const params = fn.params.map((p, i) => {
        if (p.type === IR.IRNodeType.Identifier) {
          return (p as IR.IRIdentifier).name;
        }
        return `arg${i}`;
      });
      definedFunctions.set(fn.id.name, { params, isAsync: fn.async || false });
    } else if (node.type === IR.IRNodeType.FunctionDeclaration) {
      const fn = node as IR.IRFunctionDeclaration;
      const params = fn.params.map((p) => p.name);
      definedFunctions.set(fn.id.name, { params, isAsync: fn.async || false });
    } else if (node.type === IR.IRNodeType.VariableDeclaration) {
      const decl = node as IR.IRVariableDeclaration;
      for (const declarator of decl.declarations) {
        if (declarator.id.type === IR.IRNodeType.Identifier) {
          definedVariables.add((declarator.id as IR.IRIdentifier).name);
        }
      }
    } else if (node.type === IR.IRNodeType.ClassDeclaration) {
      const cls = node as IR.IRClassDeclaration;
      const constructorParams = cls.constructor
        ? cls.constructor.params.map((p) => p.name)
        : [];
      const methods: MethodInfo[] = cls.methods.map((m) => ({
        name: m.name,
        params: m.params.map((p, i) => {
          if (p.type === IR.IRNodeType.Identifier) {
            return (p as IR.IRIdentifier).name;
          }
          return `arg${i}`;
        }),
      }));
      definedClasses.set(cls.id.name, { constructorParams, methods });
    }
  }

  // Second pass: collect exports
  for (const node of program.body) {
    if (node.type === IR.IRNodeType.ExportNamedDeclaration) {
      const exportDecl = node as IR.IRExportNamedDeclaration;
      for (const spec of exportDecl.specifiers) {
        const name = spec.exported.name;
        const localName = spec.local.name;

        if (definedFunctions.has(localName)) {
          const fnInfo = definedFunctions.get(localName)!;
          exports.push({
            name,
            kind: "function",
            params: fnInfo.params,
            isAsync: fnInfo.isAsync,
          });
        } else if (definedClasses.has(localName)) {
          const classInfo = definedClasses.get(localName)!;
          exports.push({
            name,
            kind: "class",
            classInfo,
          });
        } else {
          exports.push({ name, kind: "variable" });
        }
      }
    } else if (node.type === IR.IRNodeType.ExportDefaultDeclaration) {
      const exportDecl = node as IR.IRExportDefaultDeclaration;
      const declaration = exportDecl.declaration;

      if (declaration.type === IR.IRNodeType.Identifier) {
        const name = (declaration as IR.IRIdentifier).name;
        if (definedFunctions.has(name)) {
          const fnInfo = definedFunctions.get(name)!;
          exports.push({
            name: "default",
            kind: "default",
            params: fnInfo.params,
            isAsync: fnInfo.isAsync,
          });
        } else {
          exports.push({ name: "default", kind: "default" });
        }
      } else if (declaration.type === IR.IRNodeType.FunctionExpression) {
        const fn = declaration as IR.IRFunctionExpression;
        const params = fn.params.map((p, i) => {
          if (p.type === IR.IRNodeType.Identifier) {
            return (p as IR.IRIdentifier).name;
          }
          return `arg${i}`;
        });
        exports.push({
          name: "default",
          kind: "default",
          params,
          isAsync: fn.async || false,
        });
      } else {
        exports.push({ name: "default", kind: "default" });
      }
    }
  }

  return exports;
}

/**
 * Generate TypeScript declaration content from export information
 */
function generateDeclarationContent(exports: ExportInfo[]): string {
  const lines: string[] = [];

  for (const exp of exports) {
    if (exp.kind === "default") {
      if (exp.params) {
        const paramStr = exp.params.map(p => `${p}: any`).join(", ");
        const asyncPrefix = exp.isAsync ? "async " : "";
        lines.push(`declare ${asyncPrefix}function _default(${paramStr}): any;`);
        lines.push(`export default _default;`);
      } else {
        lines.push(`declare const _default: any;`);
        lines.push(`export default _default;`);
      }
    } else if (exp.kind === "function") {
      const paramStr = exp.params ? exp.params.map(p => `${p}: any`).join(", ") : "";
      const asyncPrefix = exp.isAsync ? "async " : "";
      lines.push(`export declare ${asyncPrefix}function ${exp.name}(${paramStr}): any;`);
    } else if (exp.kind === "class" && exp.classInfo) {
      const { constructorParams, methods } = exp.classInfo;
      lines.push(`export declare class ${exp.name} {`);
      if (constructorParams.length > 0) {
        const ctorParams = constructorParams.map(p => `${p}: any`).join(", ");
        lines.push(`  constructor(${ctorParams});`);
      }
      for (const method of methods) {
        const methodParams = method.params.map(p => `${p}: any`).join(", ");
        lines.push(`  ${method.name}(${methodParams}): any;`);
      }
      lines.push(`}`);
    } else {
      lines.push(`export declare const ${exp.name}: any;`);
    }
  }

  if (lines.length === 0) {
    lines.push("export {};");
  }

  return lines.join("\n") + "\n";
}

/**
 * Generate TypeScript declaration file content from an IR program
 */
export function generateDts(program: IR.IRProgram): string {
  const exports = extractExports(program);
  return generateDeclarationContent(exports);
}
