export interface HQLSymbol  { type: "symbol";  name: string; start?: number; end?: number; }
export interface HQLList    { type: "list";    value: HQLValue[]; start?: number; end?: number; }
export interface HQLNumber  { type: "number";  value: number;     start?: number; end?: number; }
export interface HQLString  { type: "string";  value: string;     start?: number; end?: number; }
export interface HQLBoolean { type: "boolean"; value: boolean;    start?: number; end?: number; }
export interface HQLNil     { type: "nil";     start?: number; end?: number; }
export interface HQLEnumCase { type: "enum-case"; name: string; start?: number; end?: number; }
export interface HQLOpaque  { type: "opaque";  value: any; }

export interface HQLFn {
  type: "function";
  params: string[];
  body: HQLValue[];
  closure: import("./env.ts").Env;
  isMacro?: false;
  isPure?: boolean;
  hostFn?: (args: HQLValue[]) => Promise<HQLValue> | HQLValue;
  isSync?: boolean;
  typed?: boolean;
}

export interface HQLMacro {
  type: "function";
  params: string[];
  body: HQLValue[];
  closure: import("./env.ts").Env;
  isMacro: true;
}

export type HQLValue =
  | HQLSymbol
  | HQLList
  | HQLNumber
  | HQLString
  | HQLBoolean
  | HQLNil
  | HQLFn
  | HQLMacro
  | HQLOpaque
  | any;

export function makeNil(): HQLNil { return { type: "nil" }; }
export function makeSymbol(name: string): HQLSymbol { return { type: "symbol", name }; }
export function makeList(value: HQLValue[]): HQLList { return { type: "list", value }; }
export function makeNumber(n: number): HQLNumber { return { type: "number", value: n }; }
export function makeString(s: string): HQLString { return { type: "string", value: s }; }
export function makeBoolean(b: boolean): HQLBoolean { return { type: "boolean", value: b }; }
export function makeEnumCase(name: string): HQLEnumCase { return { type: "enum-case", name }; }
