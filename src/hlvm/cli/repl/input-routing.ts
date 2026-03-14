interface NaturalLanguageDetectionOptions {
  hasBinding?: (name: string) => boolean;
}

const RESERVED_LITERAL_NAMES = new Set([
  "true",
  "false",
  "null",
  "undefined",
  "nan",
  "infinity",
]);

const JS_KEYWORD_PREFIX_REGEX =
  /^(const|let|var|function|class|import|export|async|return|if|else|for|while|switch|try|throw|new|typeof|delete)\s/;
const SIMPLE_IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ASSIGNMENT_PREFIX_REGEX = /^\w+\s*=/;
const NUMERIC_LITERAL_PREFIX_REGEX = /^[-+]?\d/;
const IDENTIFIER_OR_LITERAL_PATTERN =
  "(?:[A-Za-z_$][A-Za-z0-9_$]*|[-+]?\\d+(?:\\.\\d+)?|true|false|null|undefined|NaN|Infinity)";
const PROPERTY_ACCESS_OR_CALL_REGEX = new RegExp(
  `^(?:${IDENTIFIER_OR_LITERAL_PATTERN})(?:\\([^()]*\\))?(?:\\.(?:${IDENTIFIER_OR_LITERAL_PATTERN})(?:\\([^()]*\\))?)+$`,
);
const NON_MINUS_OPERATOR_EXPRESSION_REGEX = new RegExp(
  `^${IDENTIFIER_OR_LITERAL_PATTERN}(?:\\s*(?:[+*/%]|&&|\\|\\||===?|!==?|<=?|>=?)\\s*${IDENTIFIER_OR_LITERAL_PATTERN})+$`,
);
const SUBTRACTION_EXPRESSION_REGEX = new RegExp(
  `^${IDENTIFIER_OR_LITERAL_PATTERN}(?:\\s*-\\s*${IDENTIFIER_OR_LITERAL_PATTERN})+$`,
);

export function looksLikeNaturalLanguage(
  input: string,
  options: NaturalLanguageDetectionOptions = {},
): boolean {
  const trimmed = input.trim();
  const hasWhitespace = /\s/.test(trimmed);
  const hasBinding = options.hasBinding ?? (() => false);

  if (!trimmed) return false;

  if (trimmed.startsWith("/") || trimmed.startsWith(".")) return false;
  if (trimmed.startsWith("(") || trimmed.startsWith("[")) return false;
  if (trimmed.endsWith(")") || trimmed.endsWith("]")) return false;
  if (JS_KEYWORD_PREFIX_REGEX.test(trimmed)) return false;

  if (SIMPLE_IDENTIFIER_REGEX.test(trimmed)) {
    const lowered = trimmed.toLowerCase();
    if (RESERVED_LITERAL_NAMES.has(lowered)) {
      return false;
    }
    return !hasBinding(trimmed);
  }

  if (ASSIGNMENT_PREFIX_REGEX.test(trimmed) || /^(const|let|var)\s/.test(trimmed)) {
    return false;
  }

  if (PROPERTY_ACCESS_OR_CALL_REGEX.test(trimmed)) return false;

  const lowered = trimmed.toLowerCase();
  if (
    NUMERIC_LITERAL_PREFIX_REGEX.test(trimmed) ||
    RESERVED_LITERAL_NAMES.has(lowered)
  ) {
    return false;
  }

  if (trimmed.startsWith("`") || trimmed.startsWith("'") || trimmed.startsWith("\"")) {
    return false;
  }

  if (trimmed.startsWith("{") || trimmed.includes("=>")) return false;

  if (
    NON_MINUS_OPERATOR_EXPRESSION_REGEX.test(trimmed) ||
    SUBTRACTION_EXPRESSION_REGEX.test(trimmed)
  ) {
    return false;
  }

  if (!hasWhitespace && /[!?.,]$/.test(trimmed)) return true;
  if (!hasWhitespace) return false;

  return true;
}

