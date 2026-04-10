/**
 * Ollama command - explicit compatibility bridge to a system Ollama installation.
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

  // Forward to system Ollama (inherits current env by default)
  const platform = getPlatform();
  const child = platform.command.run({
    cmd: [ollamaPath, "serve"],
    stdout: "inherit",
    stderr: "inherit",
  });
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
      const platform = getPlatform();
      await platform.command.output({
        cmd: [path, "--version"],
        stdout: "null",
        stderr: "null",
      });
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
  Explicit compatibility command. Starts the system Ollama server on localhost:11434.
  This command is never used by HLVM's embedded runtime, bootstrap, or auto-routing.
  Requires Ollama to be installed on your system.

INSTALL:
  Download from: https://ollama.ai
`);
}
