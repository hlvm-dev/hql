#!/usr/bin/env -S deno run -A
/**
 * OpenAPI Specification Generator
 *
 * Scans handler files for @openapi JSDoc blocks and outputs docs/api/openapi.json.
 * Follows the same atomic-write pattern as build-stdlib.ts (.tmp → rename).
 */

// @ts-types="npm:@types/swagger-jsdoc@6.0.4"
import swaggerJsdoc from "npm:swagger-jsdoc@6.2.8";
import { getPlatform } from "../src/platform/platform.ts";

const platform = getPlatform();

const ROOT = new URL("..", import.meta.url).pathname;

const definition: swaggerJsdoc.Options["definition"] = {
  openapi: "3.0.3",
  info: {
    title: "HLVM REPL HTTP API",
    version: "0.1.0",
    description:
      "HTTP API for the HLVM REPL server — chat, sessions, messages, models, config, completions, and health.",
  },
  servers: [{ url: "http://127.0.0.1:11435", description: "Local REPL server" }],
  security: [{ BearerAuth: [] }],
  tags: [
    { name: "Chat", description: "Streaming chat and agent endpoints" },
    { name: "Sessions", description: "Conversation session CRUD" },
    { name: "Messages", description: "Session message CRUD" },
    { name: "Models", description: "AI model management" },
    { name: "Config", description: "Runtime configuration" },
    { name: "REPL", description: "Completions and health check" },
    { name: "Bindings", description: "HQL binding function endpoints" },
  ],
};

const apis = [
  `${ROOT}src/hlvm/cli/repl/openapi-schemas.ts`,
  `${ROOT}src/hlvm/cli/repl/handlers/chat.ts`,
  `${ROOT}src/hlvm/cli/repl/handlers/sessions.ts`,
  `${ROOT}src/hlvm/cli/repl/handlers/messages.ts`,
  `${ROOT}src/hlvm/cli/repl/handlers/models.ts`,
  `${ROOT}src/hlvm/cli/repl/handlers/config.ts`,
  `${ROOT}src/hlvm/cli/repl/handlers/sse.ts`,
  `${ROOT}src/hlvm/cli/repl/http-server.ts`,
];

const spec = swaggerJsdoc({ definition, apis }) as {
  paths?: Record<string, Record<string, unknown>>;
};

// Count paths and operations
const paths = spec.paths ?? {};
const pathCount = Object.keys(paths).length;
let operationCount = 0;
for (const methods of Object.values(paths) as Record<string, unknown>[]) {
  for (const key of Object.keys(methods)) {
    if (["get", "post", "put", "patch", "delete", "head", "options", "trace"].includes(key)) {
      operationCount++;
    }
  }
}

// Atomic write: .tmp → rename
const outDir = `${ROOT}docs/api`;
const outPath = `${outDir}/openapi.json`;
const tmpPath = `${outPath}.tmp`;

await platform.fs.mkdir(outDir, { recursive: true });
await platform.fs.writeTextFile(tmpPath, JSON.stringify(spec, null, 2) + "\n");
await platform.fs.rename(tmpPath, outPath);

console.log(`OpenAPI spec written to ${outPath}`);
console.log(`  ${pathCount} paths, ${operationCount} operations`);
