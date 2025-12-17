/**
 * Module Analyzer for External Imports
 *
 * Uses Deno's built-in tooling to analyze external modules:
 * - npm: packages
 * - jsr: packages
 * - http/https: URLs
 * - Local .js/.ts files
 *
 * Leverages `deno doc --json` for export extraction.
 */

export interface ModuleExport {
  name: string;
  kind: "function" | "class" | "variable" | "interface" | "type" | "enum" | "namespace";
  documentation?: string;
  signature?: string;
  location?: {
    filename: string;
    line: number;
    col: number;
  };
}

export interface ModuleInfo {
  specifier: string;
  exports: ModuleExport[];
  resolvedPath?: string;
  error?: string;
  cachedAt: number;
}

// ============================================
// SINGLE SOURCE OF TRUTH: Specifier Prefixes
// ============================================

/** Remote module prefixes that require network access */
const REMOTE_PREFIXES = ["npm:", "jsr:", "http:", "https:"] as const;

/** All external module prefixes (remote + node builtins) */
const EXTERNAL_PREFIXES = [...REMOTE_PREFIXES, "node:"] as const;

/** File extensions that indicate analyzable modules */
const ANALYZABLE_EXTENSIONS = [".js", ".ts", ".mjs", ".mts"] as const;

// Cache TTL: 5 minutes for remote, 30 seconds for local
const REMOTE_CACHE_TTL = 5 * 60 * 1000;
const LOCAL_CACHE_TTL = 30 * 1000;

export class ModuleAnalyzer {
  private cache = new Map<string, ModuleInfo>();
  private pendingAnalysis = new Map<string, Promise<ModuleInfo>>();

  /**
   * Analyze a module and return its exports
   */
  async analyze(specifier: string): Promise<ModuleInfo> {
    // Check cache
    const cached = this.cache.get(specifier);
    if (cached && !this.isExpired(cached, specifier)) {
      return cached;
    }

    // Check if analysis is already in progress
    const pending = this.pendingAnalysis.get(specifier);
    if (pending) {
      return pending;
    }

    // Start new analysis
    const analysisPromise = this.doAnalyze(specifier);
    this.pendingAnalysis.set(specifier, analysisPromise);

    try {
      const result = await analysisPromise;
      this.cache.set(specifier, result);
      return result;
    } finally {
      this.pendingAnalysis.delete(specifier);
    }
  }

  /**
   * Get cached exports for a module (non-blocking)
   */
  getCached(specifier: string): ModuleInfo | undefined {
    return this.cache.get(specifier);
  }

  /**
   * Check if a specifier is an external module (using constants)
   */
  isExternalModule(specifier: string): boolean {
    // Check prefixes (npm:, jsr:, http:, https:, node:)
    if (EXTERNAL_PREFIXES.some(p => specifier.startsWith(p))) {
      return true;
    }
    // Check file extensions (.js, .ts, .mjs, .mts)
    return ANALYZABLE_EXTENSIONS.some(ext => specifier.endsWith(ext));
  }

  /**
   * Check if specifier is a remote module (requires network)
   */
  private isRemoteSpecifier(specifier: string): boolean {
    return REMOTE_PREFIXES.some(p => specifier.startsWith(p));
  }

  /**
   * Check if specifier is an npm package
   */
  private isNpmSpecifier(specifier: string): boolean {
    return specifier.startsWith("npm:");
  }

  /**
   * Internal: perform the actual analysis using deno doc
   */
  private async doAnalyze(specifier: string): Promise<ModuleInfo> {
    try {
      // Use deno doc --json to extract exports
      const command = new Deno.Command("deno", {
        args: ["doc", "--json", specifier],
        stdout: "piped",
        stderr: "piped",
      });

      const { code, stdout, stderr } = await command.output();

      if (code !== 0) {
        // Fallback: try dynamic import for npm packages
        if (this.isNpmSpecifier(specifier)) {
          return this.analyzeViaImport(specifier);
        }

        const errorMsg = new TextDecoder().decode(stderr);
        return {
          specifier,
          exports: [],
          error: `Failed to analyze: ${errorMsg.slice(0, 200)}`,
          cachedAt: Date.now(),
        };
      }

      const json = new TextDecoder().decode(stdout);
      const parsed = JSON.parse(json) as { version?: number; nodes?: DenoDocNode[] } | DenoDocNode[];

      // Handle both old format (array) and new format (object with nodes)
      const nodes = Array.isArray(parsed) ? parsed : (parsed.nodes ?? []);

      const exports = this.extractExports(nodes);

      // If no exports found and it's npm, try import fallback
      if (exports.length === 0 && this.isNpmSpecifier(specifier)) {
        return this.analyzeViaImport(specifier);
      }

      // Get resolved path using deno info
      const resolvedPath = await this.getResolvedPath(specifier);

      return {
        specifier,
        exports,
        resolvedPath,
        cachedAt: Date.now(),
      };
    } catch (error) {
      // Fallback for npm packages
      if (this.isNpmSpecifier(specifier)) {
        return this.analyzeViaImport(specifier);
      }

      return {
        specifier,
        exports: [],
        error: `Analysis error: ${error instanceof Error ? error.message : String(error)}`,
        cachedAt: Date.now(),
      };
    }
  }

  /**
   * Fallback: analyze npm packages via dynamic import
   * This gets export names but not full documentation
   */
  private async analyzeViaImport(specifier: string): Promise<ModuleInfo> {
    try {
      // Use deno eval to get exports (isolated process)
      const command = new Deno.Command("deno", {
        args: [
          "eval",
          `const m = await import("${specifier}"); console.log(JSON.stringify(Object.keys(m)));`,
        ],
        stdout: "piped",
        stderr: "null",
      });

      const { code, stdout } = await command.output();

      if (code !== 0) {
        return {
          specifier,
          exports: [],
          error: "Failed to import module",
          cachedAt: Date.now(),
        };
      }

      const exportNames = JSON.parse(new TextDecoder().decode(stdout)) as string[];

      const exports: ModuleExport[] = exportNames
        .filter(name => !name.startsWith("_")) // Skip private
        .map(name => ({
          name,
          kind: "variable" as const, // We can't determine kind from import
          documentation: `Exported from ${specifier}`,
        }));

      return {
        specifier,
        exports,
        cachedAt: Date.now(),
      };
    } catch (error) {
      return {
        specifier,
        exports: [],
        error: `Import fallback error: ${error instanceof Error ? error.message : String(error)}`,
        cachedAt: Date.now(),
      };
    }
  }

  /**
   * Extract exports from deno doc JSON output
   */
  private extractExports(nodes: DenoDocNode[]): ModuleExport[] {
    const exports: ModuleExport[] = [];

    for (const node of nodes) {
      if (node.declarationKind !== "export") continue;
      if (node.kind === "moduleDoc") continue;

      const exp: ModuleExport = {
        name: node.name,
        kind: this.mapKind(node.kind),
        documentation: node.jsDoc?.doc,
        location: node.location,
      };

      // Extract signature for functions
      if (node.kind === "function" && node.functionDef) {
        exp.signature = this.buildFunctionSignature(node);
      }

      exports.push(exp);
    }

    return exports;
  }

  /**
   * Build function signature from deno doc node
   */
  private buildFunctionSignature(node: DenoDocNode): string {
    if (!node.functionDef) return `${node.name}()`;

    const params = node.functionDef.params
      ?.map((p: DenoDocParam) => {
        if (p.kind === "identifier") {
          return p.name + (p.optional ? "?" : "");
        }
        return "...";
      })
      .join(", ") ?? "";

    return `${node.name}(${params})`;
  }

  /**
   * Map deno doc kind to our kind
   */
  private mapKind(kind: string): ModuleExport["kind"] {
    switch (kind) {
      case "function": return "function";
      case "class": return "class";
      case "variable": return "variable";
      case "interface": return "interface";
      case "typeAlias": return "type";
      case "enum": return "enum";
      case "namespace": return "namespace";
      default: return "variable";
    }
  }

  /**
   * Get resolved file path using deno info
   */
  private async getResolvedPath(specifier: string): Promise<string | undefined> {
    try {
      const command = new Deno.Command("deno", {
        args: ["info", "--json", specifier],
        stdout: "piped",
        stderr: "null",
      });

      const { code, stdout } = await command.output();
      if (code !== 0) return undefined;

      const json = new TextDecoder().decode(stdout);
      const info = JSON.parse(json);

      // For local files, return the local path
      // For remote, return the cached path
      if (info.local) {
        return info.local;
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Check if cached entry is expired
   */
  private isExpired(info: ModuleInfo, specifier: string): boolean {
    const ttl = this.isRemoteSpecifier(specifier) ? REMOTE_CACHE_TTL : LOCAL_CACHE_TTL;
    return Date.now() - info.cachedAt > ttl;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Invalidate specific entry
   */
  invalidate(specifier: string): void {
    this.cache.delete(specifier);
  }
}

// Types for deno doc JSON output
interface DenoDocNode {
  name: string;
  kind: string;
  declarationKind: string;
  location?: {
    filename: string;
    line: number;
    col: number;
  };
  jsDoc?: {
    doc?: string;
  };
  functionDef?: {
    params?: DenoDocParam[];
  };
}

interface DenoDocParam {
  kind: string;
  name?: string;
  optional?: boolean;
}
