/**
 * Shared Ollama Cloud auth helpers.
 */

/** Detect auth/sign-in errors from Ollama HTTP responses. */
export function isOllamaAuthErrorMessage(message: string): boolean {
  return /unauthorized|auth|401|sign.?in/i.test(message);
}
