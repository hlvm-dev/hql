/**
 * Opt-in native GUI bridge smoke for computer use.
 *
 * Purpose:
 * - Validate the bridge-driven `hql -> native GUI CU service` happy path
 * - Avoid the agent/LLM loop; this is deterministic substrate verification
 *
 * Run:
 *   HLVM_E2E_CU_NATIVE_BRIDGE=1 \
 *   deno test --allow-all tests/e2e/cu-native-bridge-smoke.test.ts
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
import { getPlatform } from "../../src/platform/platform.ts";
import { createCliExecutor } from "../../src/hlvm/agent/computer-use/executor.ts";
import {
  invalidateBackendResolution,
  performNativeTargetAction,
  resolveBackend,
} from "../../src/hlvm/agent/computer-use/bridge.ts";
import {
  releaseComputerUseLock,
  tryAcquireComputerUseLock,
} from "../../src/hlvm/agent/computer-use/lock.ts";

const platform = getPlatform();
const ENABLED =
  platform.build.os === "darwin" &&
  platform.env.get("HLVM_E2E_CU_NATIVE_BRIDGE") === "1";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureRuntimeAuthToken(): Promise<void> {
  if ((Deno.env.get("HLVM_AUTH_TOKEN") ?? "").trim().length > 0) {
    return;
  }
  const result = await platform.command.output({
    cmd: ["curl", "-sf", "http://127.0.0.1:11435/health"],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    timeout: 2000,
  });
  if (!result.success) {
    throw new Error("Failed to read HLVM runtime health for auth token.");
  }
  const body = JSON.parse(new TextDecoder().decode(result.stdout)) as {
    authToken?: string;
  };
  if (!body.authToken) {
    throw new Error("HLVM runtime health did not include authToken.");
  }
  Deno.env.set("HLVM_AUTH_TOKEN", body.authToken);
}

Deno.test({
  name: "E2E smoke: native GUI bridge observation and target action",
  ignore: !ENABLED,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    invalidateBackendResolution();
    await ensureRuntimeAuthToken();
    const acquired = await tryAcquireComputerUseLock(
      `cu-native-bridge-smoke-${Date.now()}`,
    );
    assertEquals(acquired.kind, "acquired");

    try {
      const backend = await resolveBackend();
      assertEquals(backend.backend, "native_gui");

      const exec = createCliExecutor({
        getMouseAnimationEnabled: () => false,
        getHideBeforeActionEnabled: () => true,
      });

      await exec.openApp("com.apple.TextEdit");
      await sleep(1200);

      const prepared = await exec.prepareForAction(["com.apple.TextEdit"]);
      assertEquals(prepared.selectedTargetBundleId, "com.apple.TextEdit");
      assertExists(prepared.selectedDisplayId);

      const observation = await exec.observe({
        allowedBundleIds: [],
        preferredDisplayId: prepared.selectedDisplayId,
        displaySelectionReason: "target_window",
        resolvedTargetBundleId: "com.apple.TextEdit",
        resolvedTargetWindowId: prepared.selectedTargetWindowId,
      });

      assertEquals(observation.groundingSource, "native_targets");
      const textfield = observation.targets.find((target) =>
        target.kind === "textfield"
      );
      assertExists(textfield);

      const typed = await performNativeTargetAction("type-into-target", {
        observationId: observation.observationId,
        targetId: textfield.targetId,
        text: "HLVM_NATIVE_BRIDGE_SMOKE",
      });
      assertEquals(typed, true);

      const targetWindow = observation.windows.find((window) =>
        window.windowId === prepared.selectedTargetWindowId
      ) ?? observation.windows.find((window) =>
        window.bundleId === "com.apple.TextEdit"
      );
      assertExists(targetWindow);

      const hit = await exec.appUnderPoint(
        targetWindow.bounds.x + targetWindow.bounds.width / 2,
        targetWindow.bounds.y + targetWindow.bounds.height / 2,
      );
      assertEquals(hit?.bundleId, "com.apple.TextEdit");

      const windows = await exec.listVisibleWindows(prepared.selectedDisplayId);
      assertEquals(
        windows.some((window) => window.bundleId === "com.apple.TextEdit"),
        true,
      );
    } finally {
      await releaseComputerUseLock();
    }
  },
});
