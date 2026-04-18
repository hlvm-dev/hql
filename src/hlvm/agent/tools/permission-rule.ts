export interface PermissionRuleValue {
  toolName: string;
  ruleContent?: string;
}

function findFirstUnescapedChar(str: string, char: string): number {
  for (let i = 0; i < str.length; i++) {
    if (str[i] !== char) continue;
    let backslashCount = 0;
    let j = i - 1;
    while (j >= 0 && str[j] === "\\") {
      backslashCount++;
      j--;
    }
    if (backslashCount % 2 === 0) return i;
  }
  return -1;
}

function findLastUnescapedChar(str: string, char: string): number {
  for (let i = str.length - 1; i >= 0; i--) {
    if (str[i] !== char) continue;
    let backslashCount = 0;
    let j = i - 1;
    while (j >= 0 && str[j] === "\\") {
      backslashCount++;
      j--;
    }
    if (backslashCount % 2 === 0) return i;
  }
  return -1;
}

function unescapeRuleContent(content: string): string {
  return content
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

export function permissionRuleValueFromString(
  ruleString: string,
): PermissionRuleValue {
  const openParenIndex = findFirstUnescapedChar(ruleString, "(");
  if (openParenIndex === -1) {
    return { toolName: ruleString };
  }

  const closeParenIndex = findLastUnescapedChar(ruleString, ")");
  if (closeParenIndex === -1 || closeParenIndex <= openParenIndex) {
    return { toolName: ruleString };
  }

  if (closeParenIndex !== ruleString.length - 1) {
    return { toolName: ruleString };
  }

  const toolName = ruleString.substring(0, openParenIndex);
  const rawContent = ruleString.substring(openParenIndex + 1, closeParenIndex);

  if (!toolName) return { toolName: ruleString };

  if (rawContent === "" || rawContent === "*") {
    return { toolName };
  }

  return { toolName, ruleContent: unescapeRuleContent(rawContent) };
}
