/**
 * Single source for constructing HTTP `Authorization: Bearer <token>`
 * headers. Every site that needs a bearer header imports
 * `buildBearerHeader` from here. Callers that need only the *value*
 * (e.g., header-comparison in the server's auth gate) read `.Authorization`.
 */
export function buildBearerHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
