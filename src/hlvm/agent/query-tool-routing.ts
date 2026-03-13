/** Deduplicate and validate a tool allowlist. */
export function resolveQueryToolAllowlist(
  userAllowlist?: readonly string[],
): string[] | undefined {
  return userAllowlist?.length ? [...new Set(userAllowlist)] : undefined;
}
