import { 
  HQLValue, HQLList, makeSymbol, makeList, makeString, 
  makeNumber, makeBoolean, makeNil, makeEnumCase 
} from "./type.ts";

export function parse(input: string): HQLValue[] {
  const result: HQLValue[] = [];
  let i = 0;
  const len = input.length;
  
  function skipWs() {
    while (i < len) {
      const ch = input[i];
      if (ch === ";") {
        while (i < len && input[i] !== "\n") i++;
      } else if (/\s/.test(ch)) {
        i++;
      } else {
        break;
      }
    }
  }
  
  function readString(): HQLValue {
    i++; // skip opening quote
    let buf = "";
    let parts: HQLValue[] = [];
    let interpolation = false;
    while (i < len) {
      if (input[i] === '"') {
        i++;
        break;
      }
      // detect \(
      if (input[i] === "\\" && i + 1 < len && input[i + 1] === "(") {
        interpolation = true;
        if (buf !== "") {
          parts.push(makeString(buf));
        }
        buf = "";
        i += 2; // skip "\("
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
    if (!interpolation) {
      return makeString(buf);
    } else {
      if (buf !== "") {
        parts.push(makeString(buf));
      }
      // Wrap the parts in a list starting with the symbol 'str'
      return makeList([makeSymbol("str"), ...parts]);
    }
  }
  
  function readSymbolOrNumber(): HQLValue {
    const startPos = i;
    while (
      i < len &&
      !/\s/.test(input[i]) &&
      !["(", ")", "[", "]", ";"].includes(input[i])
    ) {
      i++;
    }
    const token = input.slice(startPos, i);
    if (token.startsWith(".")) {
      return makeEnumCase(token.slice(1));
    }
    if (/^[+\-]?\d+(\.\d+)?$/.test(token)) {
      return makeNumber(parseFloat(token));
    }
    if (token === "true")  return makeBoolean(true);
    if (token === "false") return makeBoolean(false);
    if (token === "nil")   return makeNil();
    return makeSymbol(token);
  }
  
  function readList(): HQLList {
    i++; // skip '(' or '['
    const items: HQLValue[] = [];
    while (true) {
      skipWs();
      if (i >= len) break;
      const ch = input[i];
      if (ch === ")" || ch === "]") {
        i++;
        return makeList(items);
      }
      items.push(readForm());
    }
    return makeList(items);
  }
  
  function readForm(): HQLValue {
    skipWs();
    if (i >= len) {
      return makeNil();
    }
    const ch = input[i];
    if (ch === "(" || ch === "[") {
      return readList();
    }
    if (ch === '"') {
      return readString();
    }
    if (ch === ")" || ch === "]") {
      i++;
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
