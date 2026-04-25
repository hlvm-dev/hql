import { ValidationError } from "../../../common/error.ts";

export const RUNTIME_PORT_FLAG = "--port";
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

export function extractRuntimePortFlag(args: string[]): RuntimePortFlagResult {
  const nextArgs: string[] = [];
  let port: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === RUNTIME_PORT_FLAG) {
      if (port !== undefined) {
        throw new ValidationError(
          `${RUNTIME_PORT_FLAG} specified more than once`,
          "port",
        );
      }
      port = validateRuntimePort(args[index + 1]);
      index++;
      continue;
    }
    if (arg.startsWith(`${RUNTIME_PORT_FLAG}=`)) {
      if (port !== undefined) {
        throw new ValidationError(
          `${RUNTIME_PORT_FLAG} specified more than once`,
          "port",
        );
      }
      port = validateRuntimePort(arg.slice(RUNTIME_PORT_FLAG.length + 1));
      continue;
    }
    nextArgs.push(arg);
  }

  return { args: nextArgs, port };
}

export function extractLeadingRuntimePortFlag(
  args: string[],
): RuntimePortFlagResult {
  const first = args[0];
  if (first === RUNTIME_PORT_FLAG) {
    return {
      args: args.slice(2),
      port: validateRuntimePort(args[1]),
    };
  }
  if (first?.startsWith(`${RUNTIME_PORT_FLAG}=`)) {
    return {
      args: args.slice(1),
      port: validateRuntimePort(first.slice(RUNTIME_PORT_FLAG.length + 1)),
    };
  }
  return { args };
}
