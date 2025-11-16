#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * HQL v2.0 Migration Script
 *
 * This script automatically migrates HQL code from v1.x to v2.0 syntax:
 * 1. (let ...) → (const ...) - immutable bindings
 * 2. (set! ...) → (= ...) - assignment operator
 * 3. (= ...) → (=== ...) - equality checks (v1.x = was ONLY equality)
 *
 * Usage:
 *   ./tools/migrate-v2.ts              # Dry run (show changes)
 *   ./tools/migrate-v2.ts --apply      # Apply changes
 */

import { walk } from "https://deno.land/std@0.208.0/fs/walk.ts";
import { relative } from "https://deno.land/std@0.208.0/path/mod.ts";

interface MigrationStats {
  filesProcessed: number;
  filesChanged: number;
  letToConst: number;
  setToAssign: number;
  eqToStrictEq: number;
}

const stats: MigrationStats = {
  filesProcessed: 0,
  filesChanged: 0,
  letToConst: 0,
  setToAssign: 0,
  eqToStrictEq: 0,
};

/**
 * Migrate a single file's content from v1.x to v2.0 syntax
 */
function migrateContent(content: string): { migrated: string; changed: boolean; stats: MigrationStats } {
  let migrated = content;
  const localStats: MigrationStats = {
    filesProcessed: 1,
    filesChanged: 0,
    letToConst: 0,
    setToAssign: 0,
    eqToStrictEq: 0,
  };

  // IMPORTANT: Three-pass approach to avoid double-conversion
  // Problem: If we convert (set! x y) → (= x y) first, then convert (= x y) → (=== x y),
  // we'll incorrectly convert assignments to equality checks!
  //
  // Solution: Use temporary markers to protect assignments during equality conversion

  // 1. Replace (let with (const
  // Match: (let followed by space/newline/tab
  const letMatches = migrated.match(/\(let[\s\n\t]/g);
  if (letMatches) {
    localStats.letToConst = letMatches.length;
    migrated = migrated.replace(/\(let([\s\n\t])/g, "(const$1");
  }

  // 2. Replace (set! with temporary marker __HLVM_ASSIGN__
  // Match: (set! followed by space/newline/tab
  const setMatches = migrated.match(/\(set![\s\n\t]/g);
  if (setMatches) {
    localStats.setToAssign = setMatches.length;
    migrated = migrated.replace(/\(set!([\s\n\t])/g, "(__HLVM_ASSIGN__$1");
  }

  // 3. Replace (= with (=== (equality checks only, assignments are protected)
  // In v1.x, = was ONLY used for equality (assignment was set!)
  // Match: (= followed by space/newline/tab
  const eqMatches = migrated.match(/\(=[\s\n\t]/g);
  if (eqMatches) {
    localStats.eqToStrictEq = eqMatches.length;
    migrated = migrated.replace(/\(=([\s\n\t])/g, "(===$1");
  }

  // 4. Replace temporary marker with (=
  // This converts the protected assignments to final syntax
  migrated = migrated.replace(/\(__HLVM_ASSIGN__([\s\n\t])/g, "(=$1");

  localStats.filesChanged = migrated !== content ? 1 : 0;
  return { migrated, changed: migrated !== content, stats: localStats };
}

/**
 * Process a single file
 */
async function processFile(filePath: string, dryRun: boolean): Promise<void> {
  const content = await Deno.readTextFile(filePath);
  const { migrated, changed, stats: fileStats } = migrateContent(content);

  stats.filesProcessed++;
  stats.letToConst += fileStats.letToConst;
  stats.setToAssign += fileStats.setToAssign;
  stats.eqToStrictEq += fileStats.eqToStrictEq;

  if (changed) {
    stats.filesChanged++;
    const relPath = relative(Deno.cwd(), filePath);

    console.log(`\n📝 ${relPath}`);
    if (fileStats.letToConst > 0) {
      console.log(`   - (let ...) → (const ...): ${fileStats.letToConst}`);
    }
    if (fileStats.setToAssign > 0) {
      console.log(`   - (set! ...) → (= ...): ${fileStats.setToAssign}`);
    }
    if (fileStats.eqToStrictEq > 0) {
      console.log(`   - (= ...) → (=== ...): ${fileStats.eqToStrictEq}`);
    }

    if (!dryRun) {
      await Deno.writeTextFile(filePath, migrated);
      console.log(`   ✅ Updated`);
    } else {
      console.log(`   🔍 Dry run - no changes written`);
    }
  }
}

/**
 * Main migration function
 */
async function migrate(dryRun: boolean): Promise<void> {
  const cwd = Deno.cwd();

  console.log("🔄 HQL v2.0 Migration Script");
  console.log("━".repeat(60));
  console.log(dryRun ? "Mode: DRY RUN (no files will be modified)" : "Mode: APPLY CHANGES");
  console.log("━".repeat(60));

  // Process test files
  console.log("\n📁 Processing test files...");
  for await (const entry of walk(`${cwd}/test`, {
    exts: [".ts"],
    includeDirs: false,
  })) {
    if (entry.isFile) {
      await processFile(entry.path, dryRun);
    }
  }

  // Process documentation files
  console.log("\n📁 Processing documentation files...");
  for await (const entry of walk(`${cwd}/doc`, {
    exts: [".md", ".hql"],
    includeDirs: false,
  })) {
    if (entry.isFile) {
      await processFile(entry.path, dryRun);
    }
  }

  // Summary
  console.log("\n" + "━".repeat(60));
  console.log("📊 Migration Summary");
  console.log("━".repeat(60));
  console.log(`Files processed: ${stats.filesProcessed}`);
  console.log(`Files changed: ${stats.filesChanged}`);
  console.log(`\nReplacements made:`);
  console.log(`  (let ...) → (const ...): ${stats.letToConst}`);
  console.log(`  (set! ...) → (= ...): ${stats.setToAssign}`);
  console.log(`  (= ...) → (=== ...): ${stats.eqToStrictEq}`);
  console.log(`\nTotal changes: ${stats.letToConst + stats.setToAssign + stats.eqToStrictEq}`);

  if (dryRun) {
    console.log("\n💡 To apply these changes, run:");
    console.log("   ./tools/migrate-v2.ts --apply");
  } else {
    console.log("\n✅ Migration complete!");
    console.log("\n⚠️  Next steps:");
    console.log("   1. Run: deno test --allow-all");
    console.log("   2. Fix any remaining issues");
    console.log("   3. Review changes with: git diff");
  }
}

// Parse arguments
const args = Deno.args;
const dryRun = !args.includes("--apply");

// Run migration
await migrate(dryRun);
