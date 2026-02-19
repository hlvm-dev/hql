/**
 * Minimal HTTP Router
 *
 * Supports :param path segments. No external dependencies.
 * Pattern: "/api/sessions/:id/messages" -> params { id: "uuid" }
 */

export type RouteParams = Record<string, string>;
export type RouteHandler = (req: Request, params: RouteParams) => Response | Promise<Response>;

interface Route {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

interface RouteMatch {
  handler: RouteHandler;
  params: RouteParams;
}

export function createRouter(): {
  add(method: string, pattern: string, handler: RouteHandler): void;
  match(method: string, pathname: string): RouteMatch | null;
} {
  const routes: Route[] = [];

  return {
    add(method: string, pattern: string, handler: RouteHandler): void {
      const segments = pattern.split("/").filter(Boolean);
      routes.push({ method: method.toUpperCase(), segments, handler });
    },

    match(method: string, pathname: string): RouteMatch | null {
      const pathSegments = pathname.split("/").filter(Boolean);
      const upperMethod = method.toUpperCase();

      let bestMatch: (RouteMatch & { staticCount: number }) | null = null;

      for (const route of routes) {
        if (route.method !== upperMethod) continue;
        if (route.segments.length !== pathSegments.length) continue;

        const params: RouteParams = {};
        let staticCount = 0;
        let matched = true;

        for (let i = 0; i < route.segments.length; i++) {
          const seg = route.segments[i];
          if (seg.startsWith(":")) {
            params[seg.slice(1)] = decodeURIComponent(pathSegments[i]);
          } else if (seg === pathSegments[i]) {
            staticCount++;
          } else {
            matched = false;
            break;
          }
        }

        if (!matched) continue;
        if (!bestMatch || staticCount > bestMatch.staticCount) {
          bestMatch = { handler: route.handler, params, staticCount };
        }
      }

      if (!bestMatch) return null;
      return { handler: bestMatch.handler, params: bestMatch.params };
    },
  };
}
