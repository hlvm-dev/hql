import * as IR from "../../type/hql_ir.ts";

export type Effect = "Pure" | "Impure";

export type ValueKind =
  | "Array" | "String" | "Number" | "Boolean"
  | "Map" | "Set" | "RegExp" | "Promise"
  | "Unknown" | "Untyped";

export type ParamEffectAnnotation = "Pure" | "Impure";

export interface ParameterEffectInfo {
  effect: Effect;
  source: "self" | "annotated-param" | "unannotated-param";
}

export interface EffectViolation {
  node: IR.IRNode;
  message: string;
}

export interface EffectResult {
  effect: Effect;
  violation?: EffectViolation;
}

export interface FunctionSignature {
  name: string;
  effect: Effect;
  params: { name: string; effectAnnotation?: ParamEffectAnnotation }[];
  callableParams?: Set<string>;
}

export type SignatureTable = Map<string, FunctionSignature>;
