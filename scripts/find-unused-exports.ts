/**
 * Find unused exports - exports that are never imported anywhere
 * This is the REAL unused code detection
 */

import { walk } from "https://deno.land/std@0.208.0/fs/walk.ts";

interface ExportInfo {
  file: string;
  name: string;
  type: "function" | "class" | "const" | "type" | "interface" | "enum";
  line: number;
}

const ENTRY_POINTS = new Set([
  "mod.ts",
  "src/hlvm/cli/cli.ts",
  "src/hlvm/api/index.ts",
]);

async function findAllExports(): Promise<ExportInfo[]> {
  const exports: ExportInfo[] = [];

  for await (const entry of walk("src", { exts: [".ts", ".tsx"] })) {
    if (!entry.isFile) continue;

    const content = await Deno.readTextFile(entry.path);
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match: export function name
      let match = line.match(/^export\s+function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      if (match) {
        exports.push({ file: entry.path, name: match[1], type: "function", line: i + 1 });
        continue;
      }

      // Match: export const name
      match = line.match(/^export\s+const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      if (match) {
        exports.push({ file: entry.path, name: match[1], type: "const", line: i + 1 });
        continue;
      }

      // Match: export class Name
      match = line.match(/^export\s+class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      if (match) {
        exports.push({ file: entry.path, name: match[1], type: "class", line: i + 1 });
        continue;
      }

      // Match: export interface Name
      match = line.match(/^export\s+interface\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      if (match) {
        exports.push({ file: entry.path, name: match[1], type: "interface", line: i + 1 });
        continue;
      }

      // Match: export type Name
      match = line.match(/^export\s+type\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      if (match) {
        exports.push({ file: entry.path, name: match[1], type: "type", line: i + 1 });
        continue;
      }

      // Match: export enum Name
      match = line.match(/^export\s+enum\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      if (match) {
        exports.push({ file: entry.path, name: match[1], type: "enum", line: i + 1 });
        continue;
      }

      // Match: export { name1, name2 }
      match = line.match(/^export\s*\{([^}]+)\}/);
      if (match) {
        const names = match[1].split(",").map(n => n.trim().split(/\s+as\s+/)[0].trim());
        for (const name of names) {
          if (name && /^[a-zA-Z_$]/.test(name)) {
            exports.push({ file: entry.path, name, type: "const", line: i + 1 });
          }
        }
      }
    }
  }

  return exports;
}

async function findImportsOf(exportName: string, excludeFile: string): Promise<number> {
  let count = 0;

  for await (const entry of walk("src", { exts: [".ts", ".tsx"] })) {
    if (!entry.isFile || entry.path === excludeFile) continue;

    const content = await Deno.readTextFile(entry.path);

    // Check for import { exportName }
    if (content.includes(exportName)) {
      // More precise check
      const importRegex = new RegExp(`\\b${exportName}\\b`);
      if (importRegex.test(content)) {
        count++;
      }
    }
  }

  // Also check tests
  for await (const entry of walk("tests", { exts: [".ts"] })) {
    if (!entry.isFile) continue;

    const content = await Deno.readTextFile(entry.path);
    if (content.includes(exportName)) {
      const importRegex = new RegExp(`\\b${exportName}\\b`);
      if (importRegex.test(content)) {
        count++;
      }
    }
  }

  return count;
}

async function main() {
  console.log("🔍 Finding all exports...");
  const allExports = await findAllExports();
  console.log(`   Found ${allExports.length} exports\n`);

  console.log("🔍 Checking which exports are never imported...\n");

  const unused: ExportInfo[] = [];
  let checked = 0;

  for (const exp of allExports) {
    checked++;
    if (checked % 50 === 0) {
      console.log(`   Checked ${checked}/${allExports.length}...`);
    }

    // Skip entry point files - their exports are the public API
    const isEntryPoint = ENTRY_POINTS.has(exp.file) || exp.file.endsWith("/mod.ts");
    if (isEntryPoint) continue;

    const importCount = await findImportsOf(exp.name, exp.file);

    if (importCount === 0) {
      unused.push(exp);
    }
  }

  console.log(`\n📊 Results:`);
  console.log(`   Total exports: ${allExports.length}`);
  console.log(`   Unused exports: ${unused.length}\n`);

  if (unused.length > 0) {
    console.log("❌ UNUSED EXPORTS FOUND:\n");

    // Group by file
    const byFile = new Map<string, ExportInfo[]>();
    for (const exp of unused) {
      if (!byFile.has(exp.file)) byFile.set(exp.file, []);
      byFile.get(exp.file)!.push(exp);
    }

    for (const [file, exps] of byFile) {
      console.log(`📁 ${file}`);
      for (const exp of exps) {
        console.log(`   ${exp.line}: export ${exp.type} ${exp.name}`);
      }
      console.log();
    }
  } else {
    console.log("✅ No unused exports found!");
  }
}

main();
