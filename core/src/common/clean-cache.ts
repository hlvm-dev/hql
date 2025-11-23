#!/usr/bin/env deno run -A

import { clearCache, getCacheDir, getCacheStats } from "./hql-cache-tracker.ts";
import { parse } from "https://deno.land/std@0.170.0/flags/mod.ts";
import {
  exit as platformExit,
  getArgs as platformGetArgs,
} from "../platform/platform.ts";

// Parse command line arguments
const flags = parse(platformGetArgs(), {
  boolean: ["help", "stats", "force-cache", "h"],
  string: ["age"],
  alias: { h: "help" },
});

// Get cache directory and stats
const cacheDir = await getCacheDir();
const stats = await getCacheStats();

// Format the cache size in a human-readable format
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Display cache statistics
console.log(`\nHQL Cache Information:`);
console.log(`Cache directory: ${cacheDir}`);
console.log(`Files in cache: ${stats.files}`);
console.log(`Cache size: ${formatBytes(stats.bytes)}`);

// If only stats are requested, exit here
if (flags.stats) {
  platformExit(0);
}

// Check if we need to clean based on age
if (flags.age) {
  const ageInDays = parseInt(flags.age);
  if (isNaN(ageInDays) || ageInDays < 1) {
    console.error("Error: Age must be a positive number of days");
    platformExit(1);
  }

  console.log(`\nCleaning cache entries older than ${ageInDays} days...`);
  // Implement age-based cleaning
  // This would require a more complex cleanup that traverses the cache
  console.log(
    "Age-based cleaning not yet implemented. Please use --force-cache for full cache cleanup.",
  );
  platformExit(0);
}

// Clean the cache
console.log("\nCleaning cache...");
await clearCache();
console.log("Cache cleaned successfully.");
