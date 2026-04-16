#!/usr/bin/env -S deno run --allow-all --unstable-sloppy-imports --config=src/hlvm/tui-v2/deno.json
/** Direct entry point for the donor-engine baseline. */

import { startTuiV2 } from "./mod.tsx";
import { platformExit, platformGetArgs } from "../cli/utils/platform-helpers.ts";

const showBanner = !platformGetArgs().includes("--no-banner");
const exitCode = await startTuiV2({ showBanner });
platformExit(exitCode);
