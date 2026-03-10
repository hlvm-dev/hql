function uniqueTools(tools?: readonly string[]): string[] | undefined {
  return tools?.length ? [...new Set(tools)] : undefined;
}

export function resolveQueryToolAllowlist(
  _query: string,
  userAllowlist?: string[],
): string[] | undefined {
  return uniqueTools(userAllowlist);
}
