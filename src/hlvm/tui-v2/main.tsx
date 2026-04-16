#!/usr/bin/env -S deno run --allow-all --unstable-sloppy-imports --config=src/hlvm/tui-v2/deno.json
/**
 * Direct entry point for TUI v2.
 * Bypasses cli.ts to avoid loading npm:ink@5 (old TUI) which conflicts
 * with the CC Ink fork's react-reconciler@0.31.
 *
 * Usage: deno run --allow-all --unstable-sloppy-imports src/hlvm/tui-v2/main.tsx
 * Or via Makefile: make repl-new
 */

import { startTuiV2 } from "./mod.tsx";

const showBanner = !Deno.args.includes("--no-banner");
const exitCode = await startTuiV2({ showBanner });
Deno.exit(exitCode);
