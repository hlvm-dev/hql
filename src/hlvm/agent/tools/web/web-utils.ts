import { parse as parseDomain } from "tldts";
import type { SearchResult } from "./search-provider.ts";

export interface ResultUrlAnalysis {
  host: string;
  hostWithoutWww: string;
  registrableDomain?: string;
  domainWithoutSuffix?: string;
  publicSuffix?: string;
  subdomain?: string;
  hostLabels: string[];
  subdomainLabels: string[];
  pathSegments: string[];
}

function splitLabels(value?: string | null): string[] {
  return (value ?? "")
    .toLowerCase()
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function analyzeResultUrl(url?: string): ResultUrlAnalysis | undefined {
  if (!url) return undefined;
  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname.toLowerCase();
    const hostWithoutWww = host.replace(/^www\./, "");
    const parsedDomain = parseDomain(hostWithoutWww, {
      allowPrivateDomains: true,
    });
    const subdomain = parsedDomain.subdomain?.toLowerCase();

    return {
      host,
      hostWithoutWww,
      registrableDomain: parsedDomain.domain?.toLowerCase(),
      domainWithoutSuffix: parsedDomain.domainWithoutSuffix?.toLowerCase(),
      publicSuffix: parsedDomain.publicSuffix?.toLowerCase(),
      subdomain,
      hostLabels: splitLabels(hostWithoutWww),
      subdomainLabels: splitLabels(subdomain),
      pathSegments: parsedUrl.pathname.toLowerCase().split("/").filter(Boolean),
    };
  } catch {
    return undefined;
  }
}

export function resultHost(url?: string): string | undefined {
  return analyzeResultUrl(url)?.host;
}

export function hasStructuredEvidence(result: SearchResult): boolean {
  return Boolean(
    (result.passages?.length ?? 0) > 0 ||
      result.pageDescription,
  );
}
