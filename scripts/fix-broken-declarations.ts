/**
 * Fix broken interface/class/type declarations where the declaration line was removed
 */

interface Fix {
  file: string;
  search: string;
  replace: string;
}

const FIXES: Fix[] = [
  // src/common/context-helpers.ts
  {
    file: "src/common/context-helpers.ts",
    search: `/**
 * A line of contextual code with optional highlighting
 */
  line: number;`,
    replace: `/**
 * A line of contextual code with optional highlighting
 */
interface ContextLine {
  line: number;`,
  },

  // src/common/http-client.ts - HttpOptions
  {
    file: "src/common/http-client.ts",
    search: `/**
 * HTTP request options
 */
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";`,
    replace: `/**
 * HTTP request options
 */
interface HttpOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";`,
  },

  // src/common/http-client.ts - HttpResponse
  {
    file: "src/common/http-client.ts",
    search: `/**
 * HTTP response
 */
  ok: boolean;`,
    replace: `/**
 * HTTP response
 */
interface HttpResponse<T = unknown> {
  ok: boolean;`,
  },

  // src/hlvm/api/memory.ts - MemorySummary
  {
    file: "src/hlvm/api/memory.ts",
    search: `/**
 * Memory summary statistics
 */
  total: number;`,
    replace: `/**
 * Memory summary statistics
 */
interface MemorySummary {
  total: number;`,
  },

  // src/hlvm/api/memory.ts - MemoryApi
  {
    file: "src/hlvm/api/memory.ts",
    search: `/**
 * Memory API interface
 */
  list(): Promise<string[]>;`,
    replace: `/**
 * Memory API interface
 */
interface MemoryApi {
  list(): Promise<string[]>;`,
  },

  // src/hlvm/api/errors.ts - ErrorsApi
  {
    file: "src/hlvm/api/errors.ts",
    search: `/**
 * Errors API - runtime error handling
 */
  report(error: Error | HQLError): Promise<void>;`,
    replace: `/**
 * Errors API - runtime error handling
 */
interface ErrorsApi {
  report(error: Error | HQLError): Promise<void>;`,
  },

  // src/logger.ts - LogOptions
  {
    file: "src/logger.ts",
    search: `/**
 * Options for creating a logger
 */
  verbose?: boolean;`,
    replace: `/**
 * Options for creating a logger
 */
interface LogOptions {
  verbose?: boolean;`,
  },

  // src/logger.ts - TimingOptions
  {
    file: "src/logger.ts",
    search: `/**
 * Options for timing operations
 */
  label?: string;`,
    replace: `/**
 * Options for timing operations
 */
interface TimingOptions {
  label?: string;`,
  },
];

async function applyFix(fix: Fix): Promise<boolean> {
  try {
    const content = await Deno.readTextFile(fix.file);

    if (!content.includes(fix.search)) {
      console.log(`⚠️  Pattern not found in ${fix.file}`);
      return false;
    }

    const newContent = content.replace(fix.search, fix.replace);
    await Deno.writeTextFile(fix.file, newContent);
    console.log(`✓ Fixed ${fix.file}`);
    return true;
  } catch (error) {
    console.error(`✗ Error fixing ${fix.file}: ${error}`);
    return false;
  }
}

async function main() {
  console.log("🔧 Fixing broken declarations...\n");

  let fixed = 0;
  let failed = 0;

  for (const fix of FIXES) {
    const success = await applyFix(fix);
    if (success) fixed++;
    else failed++;
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Fixed: ${fixed}`);
  console.log(`   Failed: ${failed}`);
}

main();
