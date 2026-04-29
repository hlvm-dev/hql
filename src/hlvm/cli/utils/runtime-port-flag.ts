import { ValidationError } from "../../../common/error.ts";

const RUNTIME_PORT_FLAG = "--port";
const RUNTIME_PORT_FLAG_EQ = `${RUNTIME_PORT_FLAG}=`;
export const RUNTIME_PORT_ENV = "HLVM_REPL_PORT";

export interface RuntimePortFlagResult {
  args: string[];
  port?: string;
}

function validateRuntimePort(raw: string | undefined): string {
  if (!raw?.trim()) {
    throw new ValidationError(
      `${RUNTIME_PORT_FLAG} requires a port number`,
      "port",
    );
  }
  const port = Number.parseInt(raw, 10);
  if (
    !/^\d+$/.test(raw) || !Number.isInteger(port) || port < 1 || port > 65535
  ) {
    throw new ValidationError(
      `${RUNTIME_PORT_FLAG} must be an integer from 1 to 65535`,
      "port",
    );
  }
  return String(port);
}

/** Pull the port value from `arg` (and possibly its successor). */
function consumePortAt(
  args: string[],
  index: number,
): { port: string; consumed: number } | null {
  const arg = args[index];
  if (arg === RUNTIME_PORT_FLAG) {
    return { port: validateRuntimePort(args[index + 1]), consumed: 2 };
  }
  if (arg?.startsWith(RUNTIME_PORT_FLAG_EQ)) {
    return {
      port: validateRuntimePort(arg.slice(RUNTIME_PORT_FLAG_EQ.length)),
      consumed: 1,
    };
  }
  return null;
}

export function extractRuntimePortFlag(args: string[]): RuntimePortFlagResult {
  const nextArgs: string[] = [];
  let port: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const hit = consumePortAt(args, index);
    if (hit) {
      if (port !== undefined) {
        throw new ValidationError(
          `${RUNTIME_PORT_FLAG} specified more than once`,
          "port",
        );
      }
      port = hit.port;
      index += hit.consumed - 1;
      continue;
    }
    nextArgs.push(args[index]);
  }

  return { args: nextArgs, port };
}

export function extractLeadingRuntimePortFlag(
  args: string[],
): RuntimePortFlagResult {
  const hit = consumePortAt(args, 0);
  if (!hit) return { args };
  return { args: args.slice(hit.consumed), port: hit.port };
}
