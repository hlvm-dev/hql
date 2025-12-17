/**
 * LSP Import Resolver
 *
 * Resolves HQL import paths to absolute file paths.
 *
 * Handles:
 * - Relative paths: "./math.hql", "../utils/helpers.hql"
 * - Absolute paths: "/src/lib/core.hql"
 * - File extension handling (.hql)
 *
 * Does NOT handle (returns null):
 * - npm: imports
 * - jsr: imports
 * - http/https: imports
 */

import * as path from "node:path";
import * as fs from "node:fs";

export class ImportResolver {
  private workspaceRoots: string[] = [];

  // Cache: `${containingFile}|${importPath}` → resolvedPath
  private resolutionCache = new Map<string, string | null>();

  /**
   * Set workspace roots for resolution
   */
  setRoots(roots: string[]): void {
    this.workspaceRoots = roots;
    this.clearCache();
  }

  /**
   * Add a workspace root
   */
  addRoot(root: string): void {
    if (!this.workspaceRoots.includes(root)) {
      this.workspaceRoots.push(root);
    }
  }

  /**
   * Resolve an import path to absolute file path
   *
   * @param importPath - The import path from source code (e.g., "./math.hql")
   * @param containingFile - The absolute path of the file containing the import
   * @returns Absolute file path, or null if cannot resolve
   */
  resolve(importPath: string, containingFile: string): string | null {
    const cacheKey = `${containingFile}|${importPath}`;

    if (this.resolutionCache.has(cacheKey)) {
      return this.resolutionCache.get(cacheKey) ?? null;
    }

    const resolved = this.doResolve(importPath, containingFile);
    this.resolutionCache.set(cacheKey, resolved);
    return resolved;
  }

  /**
   * Internal resolution logic
   */
  private doResolve(importPath: string, containingFile: string): string | null {
    // External modules - cannot resolve locally
    if (this.isExternalModule(importPath)) {
      return null;
    }

    // Relative paths: ./foo.hql, ../bar.hql
    if (importPath.startsWith("./") || importPath.startsWith("../")) {
      const containingDir = path.dirname(containingFile);
      let resolvedPath = path.resolve(containingDir, importPath);

      // Add .hql extension if missing
      if (!this.hasKnownExtension(resolvedPath)) {
        resolvedPath += ".hql";
      }

      // Verify file exists
      if (this.fileExists(resolvedPath)) {
        return resolvedPath;
      }

      return null;
    }

    // Absolute paths
    if (path.isAbsolute(importPath)) {
      if (this.fileExists(importPath)) {
        return importPath;
      }
      return null;
    }

    // Bare specifier - try workspace roots
    for (const root of this.workspaceRoots) {
      let candidate = path.join(root, importPath);

      if (!this.hasKnownExtension(candidate)) {
        candidate += ".hql";
      }

      if (this.fileExists(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Check if a path represents a built-in/external module
   */
  isExternalModule(importPath: string): boolean {
    return (
      importPath.startsWith("npm:") ||
      importPath.startsWith("jsr:") ||
      importPath.startsWith("http:") ||
      importPath.startsWith("https:") ||
      importPath.startsWith("node:")
    );
  }

  /**
   * Check if path has a known file extension
   */
  private hasKnownExtension(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return [".hql", ".ts", ".js", ".mjs", ".cjs"].includes(ext);
  }

  /**
   * Check if file exists
   */
  private fileExists(filePath: string): boolean {
    try {
      return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Clear entire cache
   */
  clearCache(): void {
    this.resolutionCache.clear();
  }

  /**
   * Invalidate cache entries related to a specific file
   */
  invalidateFile(filePath: string): void {
    // Remove entries where this file is the containing file
    for (const [key] of this.resolutionCache) {
      if (key.startsWith(filePath + "|")) {
        this.resolutionCache.delete(key);
      }
    }

    // Remove entries that resolve to this file
    for (const [key, value] of this.resolutionCache) {
      if (value === filePath) {
        this.resolutionCache.delete(key);
      }
    }
  }
}
