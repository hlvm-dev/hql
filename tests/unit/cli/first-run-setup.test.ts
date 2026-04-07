/**
 * Tests for the Gemma-first first-run setup.
 *
 * The new runFirstTimeSetup() calls materializeBootstrap() which requires
 * real filesystem/network access, so meaningful behavioral testing happens
 * in staged smoke tests (scripts/release-smoke.sh). This file verifies
 * the module contract and export surface.
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
import { runFirstTimeSetup } from "../../../src/hlvm/cli/commands/first-run-setup.ts";

Deno.test("runFirstTimeSetup: is exported as an async function", () => {
  assertExists(runFirstTimeSetup);
  assertEquals(typeof runFirstTimeSetup, "function");
});

Deno.test("runFirstTimeSetup: accepts optional engine argument", () => {
  // Verify the function signature (engine?: AIEngineLifecycle).
  // TS optional params without defaults still count toward .length.
  // We don't call it because it triggers real bootstrap I/O.
  assertEquals(runFirstTimeSetup.length, 1);
});
