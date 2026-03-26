export type ComposerLanguage = "chat" | "hql" | "js" | "ts";

export function detectComposerLanguage(
  defaultLanguage: ComposerLanguage,
  input: string,
): ComposerLanguage {
  if (defaultLanguage === "chat") {
    return "chat";
  }

  const trimmed = input.trimStart();
  if (/^(?:js|javascript)\b/.test(trimmed)) {
    return "js";
  }
  if (/^(?:ts|typescript)\b/.test(trimmed)) {
    return "ts";
  }

  return defaultLanguage;
}
