/**
 * Wire Command - JSON-RPC agent protocol over stdio
 */

import { log } from "../../api/log.ts";
import { initializeRuntime } from "../../../common/runtime-initializer.ts";
import { ValidationError } from "../../../common/error.ts";
import { runWireServer } from "../../agent/wire.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { ensureDefaultModelInstalled, getConfiguredModel } from "../../../common/ai-default-model.ts";

export function showWireHelp(): void {
  log.raw.log(`
HLVM Wire - JSON-RPC Agent Protocol (stdio)

USAGE:
  hlvm wire [options]

OPTIONS:
  --model <model>              Specify model (default: config model)
  --engine-strict              Use strict engine profile
  --policy <path>              Override policy file path
  --mcp <path>                 Override MCP config path
  --help, -h                   Show this help message

DESCRIPTION:
  Starts a JSON-RPC 2.0 server over stdio for agent execution.
  Methods:
    - tools.list
    - agent.run { task, model?, maxCalls?, engineProfile?, failOnContextOverflow? }
`);
}

export async function wireCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    showWireHelp();
    return;
  }

  let model: string | undefined;
  let engineStrict = false;
  let policyPath: string | undefined;
  let mcpConfigPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--model") {
      model = args[++i];
      if (!model) throw new ValidationError("Missing model value. Usage: --model <model>");
    } else if (arg === "--engine-strict") {
      engineStrict = true;
    } else if (arg === "--policy") {
      policyPath = args[++i];
      if (!policyPath) throw new ValidationError("Missing policy path. Usage: --policy <path>");
    } else if (arg === "--mcp") {
      mcpConfigPath = args[++i];
      if (!mcpConfigPath) throw new ValidationError("Missing MCP path. Usage: --mcp <path>");
    }
  }

  await initializeRuntime({ stdlib: false, cache: false });

  if (!model) {
    model = getConfiguredModel();
    try {
      await ensureDefaultModelInstalled({
        log: (message) => log.raw.log(message),
      });
    } catch (error) {
      if (error instanceof Error) {
        log.error(`Failed to setup default model: ${error.message}`);
      }
      throw error;
    }
  }

  const workspace = getPlatform().process.cwd();
  await runWireServer({
    workspace,
    model,
    engineProfile: engineStrict ? "strict" : "normal",
    policyPath,
    mcpConfigPath,
  });
}
