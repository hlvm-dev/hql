import { assertEquals } from "jsr:@std/assert";
import { config } from "../../../src/hlvm/api/config.ts";
import { withTempHlvmDir } from "../helpers.ts";

Deno.test("config.patch preserves telegram transport when updating onboardingDismissed", async () => {
  await withTempHlvmDir(async () => {
    await config.reload();
    await config.patch({
      channels: {
        telegram: {
          enabled: true,
          transport: {
            mode: "direct",
            token: "test-token",
            username: "hlvm_test_bot",
            cursor: 42,
          },
        },
      },
    });

    const updated = await config.patch({
      channels: {
        telegram: {
          onboardingDismissed: true,
        },
      },
    });

    assertEquals(updated.channels?.telegram?.onboardingDismissed, true);
    assertEquals(updated.channels?.telegram?.transport?.mode, "direct");
    assertEquals(updated.channels?.telegram?.transport?.token, "test-token");
    assertEquals(updated.channels?.telegram?.transport?.username, "hlvm_test_bot");
    assertEquals(updated.channels?.telegram?.transport?.cursor, 42);
  });
});
