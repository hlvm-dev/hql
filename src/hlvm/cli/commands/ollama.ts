/**
 * Ollama command - forwards to system Ollama installation
 * GUI calls: hlvm ollama serve
 */

import { log } from "../../api/log.ts";
import { getPlatform } from "../../../platform/platform.ts";

/**
 * Handle ollama command
 */
export async function ollamaCommand(args: string[]): Promise<number> {
  if (args.length === 0 || args[0] !== "serve") {
    log.error("Usage: hlvm ollama serve");
    return 1;
  }

  // Find system Ollama
  const ollamaPath = await findSystemOllama();
  if (!ollamaPath) {
    log.error("Ollama not found. Install from: https://ollama.ai");
    return 1;
  }

  log.info(`Starting Ollama server: ${ollamaPath}`);

  // Forward to system Ollama with all environment variables
  const command = new Deno.Command(ollamaPath, {
    args: ["serve"],
    env: Deno.env.toObject(),
    stdout: "inherit",
    stderr: "inherit",
  });

  const child = command.spawn();
  const status = await child.status;

  return status.code;
}

/**
 * Find system Ollama installation
 */
async function findSystemOllama(): Promise<string | null> {
  const locations = [
    "/usr/local/bin/ollama",
    "/opt/homebrew/bin/ollama",
    "ollama", // PATH lookup
  ];

  for (const path of locations) {
    try {
      const cmd = new Deno.Command(path, {
        args: ["--version"],
        stdout: "null",
        stderr: "null",
      });
      await cmd.output();
      return path;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Show ollama help
 */
export function showOllamaHelp(): void {
  log.raw.log(`
HLVM Ollama - Forward to system Ollama installation

USAGE:
  hlvm ollama serve

DESCRIPTION:
  Starts the Ollama server on localhost:11434.
  Requires Ollama to be installed on your system.

INSTALL:
  Download from: https://ollama.ai
`);
}
