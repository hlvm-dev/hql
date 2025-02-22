// parser.ts

import {
  HQLValue,
  HQLList,
  makeSymbol,
  makeList,
  makeString,
  makeNumber,
  makeBoolean,
  makeNil,
  makeEnumCase
} from "../modules/type.ts";

/**
 * Parse the HQL source input into an array of HQLValue AST nodes.
 * Each node now includes .start and .end offsets.
 */
export function parse(input: string): HQLValue[] {
  const result: HQLValue[] = [];
  let i = 0;
  const len = input.length;

  /**
   * Skip whitespace and line comments (starting with ;)
   */
  function skipWs() {
    while (i < len) {
      const ch = input[i];
      if (ch === ";") {
        // skip comment until newline
        while (i < len && input[i] !== "\n") {
          i++;
        }
      } else if (/\s/.test(ch)) {
        i++;
      } else {
        break;
      }
    }
  }

  /**
   * Read a double-quoted string. Also handles \( ... ) interpolation.
   */
  function readString(): HQLValue {
    // Remember the position of the opening quote
    const startPos = i;
    i++; // skip opening quote
    let buf = "";
    const parts: HQLValue[] = [];
    let interpolation = false;

    while (i < len) {
      if (input[i] === '"') {
        i++; // consume closing quote
        break;
      }
      // detect \(
      if (input[i] === "\\" && i + 1 < len && input[i + 1] === "(") {
        interpolation = true;
        if (buf !== "") {
          // push the accumulated text so far as a string node
          const strNode = makeString(buf);
          parts.push(strNode);
        }
        buf = "";
        i += 2; // skip "\("

        // read until matching ")"
        let exprStr = "";
        let parenCount = 1;
        while (i < len && parenCount > 0) {
          const c = input[i];
          if (c === "(") {
            parenCount++;
          } else if (c === ")") {
            parenCount--;
            if (parenCount === 0) {
              i++;
              break;
            }
          }
          exprStr += c;
          i++;
        }
        const subAST = parse(exprStr);
        if (subAST.length > 0) {
          parts.push(subAST[0]);
        }
      } else {
        buf += input[i];
        i++;
      }
    }

    // position after the closing quote
    const endPos = i;

    // If no interpolation, return a single string node
    if (!interpolation) {
      const node = makeString(buf);
      node.start = startPos;
      node.end = endPos;
      return node;
    } else {
      // we had interpolation, so we store the final segment as well
      if (buf !== "") {
        parts.push(makeString(buf));
      }
      // wrap the parts in a list (str ...)
      const listNode = makeList([makeSymbol("str"), ...parts]);
      listNode.start = startPos;
      listNode.end = endPos;
      return listNode;
    }
  }

  /**
   * Read either a symbol, a number, a boolean, nil, or an enum case (.foo).
   */
  function readSymbolOrNumber(): HQLValue {
    const startPos = i;
    // read until whitespace or bracket/paren
    while (
      i < len &&
      !/\s/.test(input[i]) &&
      !["(", ")", "[", "]", ";"].includes(input[i])
    ) {
      i++;
    }
    const endPos = i;
    const token = input.slice(startPos, endPos);

    // If it starts with ".", treat it as an enum case
    if (token.startsWith(".")) {
      const node = makeEnumCase(token.slice(1));
      node.start = startPos;
      node.end = endPos;
      return node;
    }
    // If numeric
    if (/^[+\-]?\d+(\.\d+)?$/.test(token)) {
      const node = makeNumber(parseFloat(token));
      node.start = startPos;
      node.end = endPos;
      return node;
    }
    // If boolean
    if (token === "true") {
      const node = makeBoolean(true);
      node.start = startPos;
      node.end = endPos;
      return node;
    }
    if (token === "false") {
      const node = makeBoolean(false);
      node.start = startPos;
      node.end = endPos;
      return node;
    }
    // If nil
    if (token === "nil") {
      const node = makeNil();
      node.start = startPos;
      node.end = endPos;
      return node;
    }
    // Otherwise a normal symbol
    const symNode = makeSymbol(token);
    symNode.start = startPos;
    symNode.end = endPos;
    return symNode;
  }

  /**
   * Read a list (either parenthesized or bracketed).
   * e.g. "(...)" or "[...]"
   */
  function readList(): HQLList {
    const startPos = i;
    const openChar = input[i];
    i++; // skip the '(' or '['
    const items: HQLValue[] = [];

    while (true) {
      skipWs();
      if (i >= len) break;
      const ch = input[i];
      if ((openChar === "(" && ch === ")") || (openChar === "[" && ch === "]")) {
        i++; // consume the closing char
        const listNode = makeList(items);
        listNode.start = startPos;
        listNode.end = i;
        return listNode;
      }
      items.push(readForm());
    }
    const listNode = makeList(items);
    listNode.start = startPos;
    listNode.end = i;
    return listNode;
  }

  /**
   * Read one form (string, symbol, number, list, etc.).
   */
  function readForm(): HQLValue {
    skipWs();
    if (i >= len) return makeNil();
    const ch = input[i];
    if (ch === "(" || ch === "[") {
      return readList();
    }
    if (ch === '"') {
      return readString();
    }
    if (ch === ")" || ch === "]") {
      i++; // consume extra closing
      return makeNil();
    }
    return readSymbolOrNumber();
  }

  while (true) {
    skipWs();
    if (i >= len) break;
    result.push(readForm());
  }

  return result;
}
