import { assertEquals } from "jsr:@std/assert";
import { areRuntimeHostBuildIdsCompatible } from "../../../src/hlvm/runtime/host-identity.ts";

Deno.test("runtime host identity accepts same build with different artifact paths", () => {
  assertEquals(
    areRuntimeHostBuildIdsCompatible(
      "1.0.0|/Users/me/dev/hql/src/hlvm/cli/cli.ts|123|456",
      "1.0.0|/private/var/folders/runtime/cli.ts|123|456",
    ),
    true,
  );
});

Deno.test("runtime host identity rejects stale builds when the timestamp changes", () => {
  assertEquals(
    areRuntimeHostBuildIdsCompatible(
      "1.0.0|/Users/me/dev/hql/src/hlvm/cli/cli.ts|123|456",
      "1.0.0|/private/var/folders/runtime/cli.ts|123|789",
    ),
    false,
  );
});
