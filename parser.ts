#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env
//////////////////////////////////////////////////////////////////////////////
// 1. AST DEFINITIONS
//////////////////////////////////////////////////////////////////////////////

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
  | HQLEnumCase
  | any;

export interface HQLSymbol  { type: "symbol";  name: string; }
export interface HQLList    { type: "list";    value: HQLValue[]; }
export interface HQLNumber  { type: "number";  value: number; }
export interface HQLString  { type: "string";  value: string; }
export interface HQLBoolean { type: "boolean"; value: boolean; }
export interface HQLNil     { type: "nil"; }
export interface HQLOpaque { type: "opaque"; value: any; }
export interface HQLEnumCase { type: "enum-case"; name: string; }
export interface HQLFn {
  type: "function";
  params: string[];
  body: HQLValue[];
  closure: any; // (usually your Env type)
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
  closure: any; // (usually your Env type)
  isMacro: true;
}

//////////////////////////////////////////////////////////////////////////////
// FACTORY FUNCTIONS
//////////////////////////////////////////////////////////////////////////////

export function makeSymbol(name: string): HQLSymbol { return { type: "symbol", name }; }
export function makeList(value: HQLValue[]): HQLList { return { type: "list", value }; }
export function makeNumber(n: number): HQLNumber { return { type: "number", value: n }; }
export function makeString(s: string): HQLString { return { type: "string", value: s }; }
export function makeBoolean(b: boolean): HQLBoolean { return { type: "boolean", value: b }; }
export function makeNil(): HQLNil { return { type: "nil" }; }
export function makeEnumCase(name: string): HQLEnumCase { return { type: "enum-case", name }; }

//////////////////////////////////////////////////////////////////////////////
// PARSER
//////////////////////////////////////////////////////////////////////////////

export function parse(hql: string): HQLValue[] {
  const result: HQLValue[] = [];
  let i = 0, len = hql.length;

  function skipWs() {
    while (i < len) {
      const ch = hql.charAt(i);
      if (ch === ";") {
        while (i < len && hql.charAt(i) !== "\n") i++;
      } else if (/\s/.test(ch)) {
        i++;
      } else {
        break;
      }
    }
  }

  // Modified readString to support interpolation syntax like:
  // "hello my name is \(name) and nice to meet you - \(name)"
  function readString(): HQLValue {
    i++; // skip opening quote
    let buf = "";
    let parts: HQLValue[] = [];
    let interpolation = false;
    while (i < len) {
      let ch = hql.charAt(i);
      if (ch === '"') {
        i++; // skip closing quote
        break;
      } else if (ch === "\\" && hql.charAt(i + 1) === "(") {
        interpolation = true;
        // Push current literal (even if empty)
        parts.push(makeString(buf));
        buf = "";
        i += 2; // Skip over "\("
        // Parse until matching ")" is found.
        let exprStr = "";
        let parenCount = 1;
        while (i < len && parenCount > 0) {
          let c = hql.charAt(i);
          if (c === "(") {
            parenCount++;
          } else if (c === ")") {
            parenCount--;
            if (parenCount === 0) {
              i++; // Skip the closing ")"
              break;
            }
          }
          exprStr += c;
          i++;
        }
        if (parenCount !== 0) {
          throw new Error("Unmatched parenthesis in interpolation");
        }
        // Parse the expression inside the interpolation.
        const exprForms = parse(exprStr);
        if (exprForms.length !== 1) {
          throw new Error("Interpolation expression must produce a single form");
        }
        parts.push(exprForms[0]);
      } else {
        buf += ch;
        i++;
      }
    }
    if (!interpolation) {
      return makeString(buf);
    } else {
      if (buf !== "") {
        parts.push(makeString(buf));
      }
      // Return an S-expression that calls (str ...), which is our alias for string concatenation.
      return makeList([makeSymbol("str"), ...parts]);
    }
  }

  function readNumberOrSymbol(): HQLValue {
    const start = i;
    while (
      i < len &&
      !/\s/.test(hql.charAt(i)) &&
      !["(", ")", "[", "]", ";"].includes(hql.charAt(i))
    ) {
      i++;
    }
    const raw = hql.slice(start, i);
    if (raw.startsWith(".")) {
      return makeEnumCase(raw.substring(1));
    }
    if (/^[+-]?\d+(\.\d+)?$/.test(raw)) return makeNumber(parseFloat(raw));
    if (raw === "true") return makeBoolean(true);
    if (raw === "false") return makeBoolean(false);
    if (raw === "nil") return makeNil();
    return makeSymbol(raw);
  }

  function readList(): HQLList {
    i++; // skip opening ( or [
    const items: HQLValue[] = [];
    while (true) {
      skipWs();
      if (i >= len) throw new Error("Missing closing )");
      const ch = hql.charAt(i);
      if (ch === ")" || ch === "]") {
        i++;
        break;
      }
      items.push(readForm());
    }
    return makeList(items);
  }

  function readForm(): HQLValue {
    skipWs();
    if (i >= len) {
      throw new Error("Unexpected EOF");
    }
    const ch = hql.charAt(i);
    if (ch === "(" || ch === "[") return readList();
    if (ch === '"') return readString();
    if (ch === ")" || ch === "]") throw new Error("Unexpected )");
    return readNumberOrSymbol();
  }

  while (true) {
    skipWs();
    if (i >= len) break;
    result.push(readForm());
  }
  return result;
}
