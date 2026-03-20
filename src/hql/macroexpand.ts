import { expandHql } from "./transpiler/hql-transpiler.ts";
import { sexpToString } from "./s-exp/types.ts";
import { getPlatform } from "../platform/platform.ts";
import type { MacroExpansionTraceStep } from "./s-exp/macro.ts";

export interface MacroExpandOptions {
  baseDir?: string;
  currentFile?: string;
  verbose?: boolean;
}

export interface MacroExpandTraceResult {
  expanded: string[];
  trace: MacroExpansionTraceStep[];
}

const platformCwd = () => getPlatform().process.cwd();

async function macroexpandInternal(
  source: string,
  iterationLimit: number | undefined,
  options: MacroExpandOptions = {},
  macroOverrides: { maxExpandDepth?: number } = {},
  traceCollector?: MacroExpansionTraceStep[],
): Promise<string[]> {
  const processOptions = {
    baseDir: options.baseDir ?? platformCwd(),
    currentFile: options.currentFile,
    verbose: options.verbose,
  };

  const expanded = await expandHql(source, processOptions, {
    iterationLimit,
    currentFile: options.currentFile,
    verbose: options.verbose,
    maxExpandDepth: macroOverrides.maxExpandDepth,
    traceCollector,
  });

  return expanded.map((expr) => sexpToString(expr));
}

export function macroexpand(
  source: string,
  options: MacroExpandOptions = {},
): Promise<string[]> {
  return macroexpandInternal(source, undefined, options);
}

export function macroexpand1(
  source: string,
  options: MacroExpandOptions = {},
): Promise<string[]> {
  return macroexpandInternal(source, 1, options, { maxExpandDepth: 0 });
}

export function macroexpandAll(
  source: string,
  options: MacroExpandOptions = {},
): Promise<string[]> {
  return macroexpandInternal(source, undefined, options);
}

export async function macroexpandTrace(
  source: string,
  options: MacroExpandOptions = {},
): Promise<MacroExpandTraceResult> {
  const trace: MacroExpansionTraceStep[] = [];
  const expanded = await macroexpandInternal(
    source,
    undefined,
    options,
    {},
    trace,
  );
  return { expanded, trace };
}
