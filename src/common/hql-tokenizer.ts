/**
 * HQL Tokenizer (SSOT)
 *
 * Lightweight tokenizer for structural selection and tooling.
 * Designed to be browser-safe (no Deno/Node dependencies).
 */

export type HqlTokenType =
  | "whitespace"
  | "comment"
  | "string"
  | "template"
  | "open"
  | "close"
  | "prefix"
  | "symbol";

export interface HqlToken {
  readonly type: HqlTokenType;
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

const HQL_OPENERS = new Set(["(", "[", "{"]);
const HQL_CLOSERS = new Set([")", "]", "}"]);
const TEMPLATE_BLOCKERS = new Set(["(", "["]);
const PREFIX_TOKENS = new Set(["'", "`", "~", "~@"]);

function scanLineComment(input: string, start: number): number {
  let i = start + 2;
  while (i < input.length && input[i] !== "\n") i++;
  return i;
}

function scanBlockComment(input: string, start: number): number {
  let i = start + 2;
  while (i < input.length - 1) {
    if (input[i] === "*" && input[i + 1] === "/") return i + 2;
    i++;
  }
  return input.length;
}

function scanQuotedString(input: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < input.length) {
    const ch = input[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i++;
  }
  return input.length;
}

function scanTemplateLiteral(input: string, start: number): number {
  let i = start + 1;
  let braceDepth = 0;

  while (i < input.length) {
    const ch = input[i];
    const next = i + 1 < input.length ? input[i + 1] : "";

    if (ch === "\\") {
      i += 2;
      continue;
    }

    if (braceDepth === 0) {
      if (ch === "`") return i + 1;
      if (ch === "$" && next === "{") {
        braceDepth = 1;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (ch === "\"") {
      i = scanQuotedString(input, i, "\"");
      continue;
    }

    if (ch === "`") {
      const nextChar = i + 1 < input.length ? input[i + 1] : "";
      if (!TEMPLATE_BLOCKERS.has(nextChar)) {
        const nestedEnd = scanTemplateLiteral(input, i);
        if (nestedEnd === -1) return -1;
        i = nestedEnd;
        continue;
      }
    }

    if (ch === "/" && next === "/") {
      i = scanLineComment(input, i);
      continue;
    }

    if (ch === "/" && next === "*") {
      i = scanBlockComment(input, i);
      continue;
    }

    if (ch === "{") {
      braceDepth++;
      i++;
      continue;
    }

    if (ch === "}") {
      braceDepth--;
      i++;
      continue;
    }

    i++;
  }

  return -1;
}

export function tokenizeHql(input: string): HqlToken[] {
  const tokens: HqlToken[] = [];
  if (!input) return tokens;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    const next = i + 1 < input.length ? input[i + 1] : "";

    if (/\s/.test(ch)) {
      const start = i;
      while (i < input.length && /\s/.test(input[i])) i++;
      tokens.push({ type: "whitespace", value: input.slice(start, i), start, end: i });
      continue;
    }

    if (ch === "/" && next === "/") {
      const start = i;
      i = scanLineComment(input, i);
      tokens.push({ type: "comment", value: input.slice(start, i), start, end: i });
      continue;
    }

    if (ch === "/" && next === "*") {
      const start = i;
      i = scanBlockComment(input, i);
      tokens.push({ type: "comment", value: input.slice(start, i), start, end: i });
      continue;
    }

    if (ch === "\"") {
      const start = i;
      i = scanQuotedString(input, i, "\"");
      tokens.push({ type: "string", value: input.slice(start, i), start, end: i });
      continue;
    }

    if (ch === "`" && !TEMPLATE_BLOCKERS.has(next)) {
      const start = i;
      const end = scanTemplateLiteral(input, i);
      if (end !== -1) {
        i = end;
        tokens.push({ type: "template", value: input.slice(start, i), start, end: i });
        continue;
      }
      const prefixStart = i;
      i++;
      tokens.push({ type: "prefix", value: "`", start: prefixStart, end: i });
      continue;
    }

    if (ch === "#" && next === "[") {
      const start = i;
      i += 2;
      tokens.push({ type: "open", value: "#[", start, end: i });
      continue;
    }

    if (ch === "~" && next === "@") {
      const start = i;
      i += 2;
      tokens.push({ type: "prefix", value: "~@", start, end: i });
      continue;
    }

    if (ch === "'" || ch === "`" || ch === "~") {
      const start = i;
      i++;
      tokens.push({ type: "prefix", value: ch, start, end: i });
      continue;
    }

    if (HQL_OPENERS.has(ch)) {
      tokens.push({ type: "open", value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    if (HQL_CLOSERS.has(ch)) {
      tokens.push({ type: "close", value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    const start = i;
    while (i < input.length && !/\s/.test(input[i]) && !isHqlDelimiter(input[i])) i++;
    tokens.push({ type: "symbol", value: input.slice(start, i), start, end: i });
  }

  return tokens;
}

export function firstMeaningfulToken(input: string): HqlToken | null {
  const tokens = tokenizeHql(input);
  for (const token of tokens) {
    if (token.type !== "whitespace" && token.type !== "comment") return token;
  }
  return null;
}

export function isHqlDelimiter(ch: string): boolean {
  return ch === "(" || ch === ")" || ch === "[" || ch === "]" ||
    ch === "{" || ch === "}" || ch === "\"" || ch === "'" ||
    ch === "`" || ch === "," || ch === ";" || ch === "~";
}

export function isHqlPrefix(value: string): boolean {
  return PREFIX_TOKENS.has(value);
}
