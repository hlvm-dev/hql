/**
 * Tests for publish/utils.ts
 *
 * Coverage:
 * - incrementPatchVersion() with @std/semver
 * - compareVersions() with @std/semver
 * - resolveNextPublishVersion() integration
 * - Edge cases: pre-release, invalid, boundary values
 */

import { assertEquals } from "jsr:@std/assert";
import {
  incrementPatchVersion,
  compareVersions,
  resolveNextPublishVersion,
} from "../../../src/hlvm/cli/publish/utils.ts";

// ============================================================
// incrementPatchVersion()
// ============================================================

Deno.test("incrementPatchVersion - basic patch increment", () => {
  assertEquals(incrementPatchVersion("1.0.0"), "1.0.1");
  assertEquals(incrementPatchVersion("0.1.0"), "0.1.1");
  assertEquals(incrementPatchVersion("2.3.4"), "2.3.5");
});

Deno.test("incrementPatchVersion - overflow patch number", () => {
  assertEquals(incrementPatchVersion("1.0.99"), "1.0.100");
  assertEquals(incrementPatchVersion("1.0.999"), "1.0.1000");
});

Deno.test("incrementPatchVersion - pre-release drops to release", () => {
  // SemVer 2.0 spec: patch increment on pre-release drops pre-release tag
  // 1.2.3-beta.1 → 1.2.3 (releases the pre-release as the actual patch version)
  assertEquals(incrementPatchVersion("1.2.3-beta.1"), "1.2.3");
});

Deno.test("incrementPatchVersion - invalid version returns fallback", () => {
  assertEquals(incrementPatchVersion(""), "0.0.1");
  assertEquals(incrementPatchVersion("invalid"), "0.0.1");
  assertEquals(incrementPatchVersion("abc.def.ghi"), "0.0.1");
});

Deno.test("incrementPatchVersion - zero version", () => {
  assertEquals(incrementPatchVersion("0.0.0"), "0.0.1");
});

// ============================================================
// compareVersions()
// ============================================================

Deno.test("compareVersions - basic ordering", () => {
  assertEquals(compareVersions("1.0.0", "2.0.0") < 0, true);
  assertEquals(compareVersions("2.0.0", "1.0.0") > 0, true);
  assertEquals(compareVersions("1.0.0", "1.0.0"), 0);
});

Deno.test("compareVersions - patch comparison", () => {
  assertEquals(compareVersions("1.0.0", "1.0.1") < 0, true);
  assertEquals(compareVersions("1.0.2", "1.0.1") > 0, true);
});

Deno.test("compareVersions - minor comparison", () => {
  assertEquals(compareVersions("1.1.0", "1.2.0") < 0, true);
  assertEquals(compareVersions("1.3.0", "1.2.0") > 0, true);
});

Deno.test("compareVersions - major comparison", () => {
  assertEquals(compareVersions("1.0.0", "2.0.0") < 0, true);
  assertEquals(compareVersions("3.0.0", "2.0.0") > 0, true);
});

Deno.test("compareVersions - pre-release ordering", () => {
  // Pre-release versions have lower precedence than release
  assertEquals(compareVersions("1.0.0-alpha", "1.0.0") < 0, true);
  assertEquals(compareVersions("1.0.0", "1.0.0-alpha") > 0, true);
});

Deno.test("compareVersions - invalid versions fall back to localeCompare", () => {
  // Both invalid → localeCompare
  const result = compareVersions("abc", "xyz");
  assertEquals(typeof result, "number");
  assertEquals(result < 0, true); // "abc" < "xyz" lexicographically

  // One invalid → localeCompare fallback
  const result2 = compareVersions("invalid", "1.0.0");
  assertEquals(typeof result2, "number");
});

Deno.test("compareVersions - never throws", () => {
  // Verify the never-throw contract
  let threw = false;
  try {
    compareVersions("", "");
    compareVersions("not-semver", "also-not-semver");
    compareVersions("1.0.0", "garbage");
    compareVersions("garbage", "1.0.0");
  } catch {
    threw = true;
  }
  assertEquals(threw, false);
});

// ============================================================
// resolveNextPublishVersion() integration
// ============================================================

Deno.test("resolveNextPublishVersion - both remote and local, remote higher", async () => {
  const result = await resolveNextPublishVersion(
    "1.2.3",
    "1.0.0",
    async (_msg, def) => def,
    incrementPatchVersion,
    "jsr",
  );
  assertEquals(result, "1.2.4");
});

Deno.test("resolveNextPublishVersion - both remote and local, local higher", async () => {
  const result = await resolveNextPublishVersion(
    "1.0.0",
    "1.2.3",
    async (_msg, def) => def,
    incrementPatchVersion,
    "jsr",
  );
  assertEquals(result, "1.2.4");
});

Deno.test("resolveNextPublishVersion - equal versions", async () => {
  const result = await resolveNextPublishVersion(
    "1.0.0",
    "1.0.0",
    async (_msg, def) => def,
    incrementPatchVersion,
    "jsr",
  );
  assertEquals(result, "1.0.1");
});

Deno.test("resolveNextPublishVersion - remote only", async () => {
  const result = await resolveNextPublishVersion(
    "2.0.0",
    null,
    async (_msg, def) => def,
    incrementPatchVersion,
    "npm",
  );
  assertEquals(result, "2.0.1");
});

Deno.test("resolveNextPublishVersion - local only", async () => {
  const result = await resolveNextPublishVersion(
    null,
    "0.5.0",
    async (_msg, def) => def,
    incrementPatchVersion,
    "npm",
  );
  assertEquals(result, "0.5.1");
});

Deno.test("resolveNextPublishVersion - neither remote nor local", async () => {
  const result = await resolveNextPublishVersion(
    null,
    null,
    async (_msg, def) => def,
    incrementPatchVersion,
    "jsr",
  );
  assertEquals(result, "0.0.1");
});
