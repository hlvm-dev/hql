export interface ContinuationAnalysis {
  needsContinuation: boolean;
  indentLevel: number;
}

const OPENERS = new Map<string, string>([
  ["(", ")"],
  ["{", "}"],
  ["[", "]"],
]);

const CLOSERS = new Map<string, string>();
for (const [open, close] of OPENERS.entries()) {
  CLOSERS.set(close, open);
}

const STRING_DELIMS = new Set(["'", "\"", "`"]);

export function analyzeContinuation(source: string): ContinuationAnalysis {
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let inString: string | null = null;
  let escapeNext = false;

  for (const char of source) {
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === "\\") {
        escapeNext = true;
        continue;
      }
      if (char === inString) {
        inString = null;
      }
      continue;
    }

    if (STRING_DELIMS.has(char)) {
      inString = char;
      continue;
    }

    if (OPENERS.has(char)) {
      switch (char) {
        case "(":
          paren++;
          break;
        case "{":
          brace++;
          break;
        case "[":
          bracket++;
          break;
      }
      continue;
    }

    const opener = CLOSERS.get(char);
    if (opener) {
      switch (opener) {
        case "(":
          paren = Math.max(0, paren - 1);
          break;
        case "{":
          brace = Math.max(0, brace - 1);
          break;
        case "[":
          bracket = Math.max(0, bracket - 1);
          break;
      }
    }
  }

  const needsContinuation = inString !== null ||
    paren > 0 || brace > 0 || bracket > 0;
  const indentLevel = Math.max(0, paren + brace + bracket);

  return { needsContinuation, indentLevel };
}
