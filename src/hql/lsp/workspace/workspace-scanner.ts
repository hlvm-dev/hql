/**
 * Workspace Scanner - Index HQL files on LSP startup
 *
 * Scans workspace directories to populate ProjectIndex,
 * enabling auto-import for files that haven't been opened.
 */

import { walk } from "https://deno.land/std@0.208.0/fs/walk.ts";
import type { ProjectIndex } from "./project-index.ts";
import { analyzeDocument } from "../analysis.ts";
import { getPlatform } from "../../../platform/platform.ts";

/** Directories to skip during scanning */
const SKIP_PATTERNS = [
  /node_modules/,
  /\.git/,
  /dist/,
  /build/,
  /target/,
  /\.hlvm-cache/,
];

/** Result of workspace scan */
export interface ScanResult {
  filesIndexed: number;
  filesSkipped: number;
  durationMs: number;
}

/**
 * Workspace Scanner
 *
 * Simple scanner that walks workspace and indexes all HQL files.
 */
export class WorkspaceScanner {
  constructor(private projectIndex: ProjectIndex) {}

  /**
   * Scan workspace roots and populate the project index
   */
  async scan(workspaceRoots: string[]): Promise<ScanResult> {
    const startTime = Date.now();
    let filesIndexed = 0;
    let filesSkipped = 0;

    for (const root of workspaceRoots) {
      try {
        for await (const entry of walk(root, {
          exts: [".hql"],
          includeDirs: false,
          followSymlinks: false,
          skip: SKIP_PATTERNS,
        })) {
          const indexed = await this.indexFile(entry.path);
          if (indexed) {
            filesIndexed++;
          } else {
            filesSkipped++;
          }
        }
      } catch {
        // Root directory might not exist - skip silently
      }
    }

    return {
      filesIndexed,
      filesSkipped,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Index a single file
   */
  private async indexFile(filePath: string): Promise<boolean> {
    try {
      const content = await getPlatform().fs.readTextFile(filePath);
      const analysis = analyzeDocument(content, filePath);
      this.projectIndex.indexFile(filePath, analysis);
      return true;
    } catch {
      return false;
    }
  }
}
