/**
 * CLI Command — hlvm hql
 * Subcommand namespace for HQL language operations: init, compile, publish.
 */

import { log } from "../../api/log.ts";
import { ValidationError } from "../../../common/error.ts";
import { hasHelpFlag } from "../utils/common-helpers.ts";
import { compileCommand, showCompileHelp } from "./compile.ts";
import { init as initCommand, showInitHelp } from "./init.ts";
import { publishCommand, showPublishHelp } from "./publish.ts";

export function showHqlHelp(): void {
  log.raw.log(`
HQL — Language tools for HQL modules

Usage: hlvm hql <command> [options]

Commands:
  init               Initialize a new HQL project
  compile <file>     Compile HQL to JavaScript or native binary
  publish            Publish an HQL package

Examples:
  hlvm hql init -y              Quick-start a new project
  hlvm hql compile app.hql      Compile to JavaScript
  hlvm hql publish              Publish to JSR and NPM

For command-specific help:
  hlvm hql <command> --help
`);
}

type HqlSubcommandEntry = {
  run: (args: string[]) => Promise<unknown>;
  help: () => void;
};

const HQL_COMMANDS: Record<string, HqlSubcommandEntry> = {
  init: { run: initCommand, help: showInitHelp },
  compile: { run: compileCommand, help: showCompileHelp },
  publish: { run: publishCommand, help: showPublishHelp },
};

export async function hqlCommand(args: string[]): Promise<void> {
  if (args.length === 0) {
    showHqlHelp();
    return;
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);

  // Show hql-level help only when `hlvm hql --help` (no subcommand)
  if (!HQL_COMMANDS[subcommand] && hasHelpFlag(args)) {
    showHqlHelp();
    return;
  }

  const entry = HQL_COMMANDS[subcommand];
  if (!entry) {
    throw new ValidationError(
      `Unknown hql command: ${subcommand}. Run 'hlvm hql --help' for usage.`,
    );
  }

  if (hasHelpFlag(subArgs)) {
    entry.help();
  } else {
    await entry.run(subArgs);
  }
}
