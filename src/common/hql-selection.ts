/**
 * HQL Selection Utilities (SSOT)
 *
 * Provides structural range selection for HQL code using the shared tokenizer.
 * Offsets are UTF-16 indices (matching JavaScript string indexing).
 */

import { tokenizeHql, isHqlPrefix, type HqlToken } from "./hql-tokenizer.ts";

export interface HqlRange {
  start: number;
  end: number;
}

const MATCH_CLOSE: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "#[": "]",
};

function isMatchingPair(openValue: string, closeValue: string): boolean {
  const expected = MATCH_CLOSE[openValue];
  return expected === closeValue;
}

function findPrefixStart(tokens: HqlToken[], openIndex: number): number {
  let start = tokens[openIndex].start;
  let i = openIndex - 1;
  while (i >= 0) {
    const token = tokens[i];
    if (token.type === "whitespace" || token.type === "comment") {
      i--;
      continue;
    }
    if (token.type === "prefix" && isHqlPrefix(token.value)) {
      start = token.start;
      i--;
      continue;
    }
    break;
  }
  return start;
}

function buildTopLevelForms(tokens: HqlToken[], code: string): HqlRange[] {
  const forms: HqlRange[] = [];
  if (tokens.length === 0) return forms;

  const stack: Array<{ value: string; start: number; openIndex: number }> = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.type === "open") {
      const start = findPrefixStart(tokens, i);
      stack.push({ value: token.value, start, openIndex: i });
      continue;
    }

    if (token.type !== "close") continue;
    if (stack.length === 0) continue;

    let matchIndex = -1;
    for (let j = stack.length - 1; j >= 0; j--) {
      if (isMatchingPair(stack[j].value, token.value)) {
        matchIndex = j;
        break;
      }
    }
    if (matchIndex === -1) continue;

    const opener = stack[matchIndex];
    stack.splice(matchIndex);

    if (matchIndex === 0) {
      forms.push({ start: opener.start, end: token.end });
    }
  }

  // If we have unclosed top-level forms, capture from start to end of code.
  if (stack.length > 0) {
    const opener = stack[0];
    const end = Math.max(opener.start, code.length);
    forms.push({ start: opener.start, end });
  }

  forms.sort((a, b) => a.start - b.start);
  return forms;
}

export function splitTopLevelHqlForms(code: string): HqlRange[] {
  if (!code) return [];
  const tokens = tokenizeHql(code);
  return buildTopLevelForms(tokens, code);
}

export function selectHqlForm(code: string, cursor: number): HqlRange | null {
  if (!code) return null;
  const tokens = tokenizeHql(code);
  const forms = buildTopLevelForms(tokens, code);
  if (forms.length === 0) return null;

  const pos = Math.max(0, Math.min(cursor, code.length));
  for (const form of forms) {
    if (pos >= form.start && pos <= form.end) {
      return form;
    }
  }
  return null;
}
