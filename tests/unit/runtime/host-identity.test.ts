import {
  assertEquals,
  assertExists,
} from "jsr:@std/assert";
import {
  areRuntimeHostBuildIdsCompatible,
  parseRuntimeHostBuildId,
} from "../../../src/hlvm/runtime/host-identity.ts";

Deno.test("parseRuntimeHostBuildId parses source and binary-style build ids", () => {
  const parsed = parseRuntimeHostBuildId(
    "0.1.0|/Users/me/dev/hql/hlvm|203277202|1773059460285",
  );
  assertExists(parsed);
  assertEquals(parsed.version, "0.1.0");
  assertEquals(parsed.artifactBaseName, "hlvm");
  assertEquals(parsed.kind, "binary");
  assertEquals(parsed.size, 203277202);
});

Deno.test("areRuntimeHostBuildIdsCompatible accepts equivalent compiled artifacts with different paths", () => {
  const expected =
    "0.1.0|/private/var/folders/runtime/hlvm|203277202|1773059460285";
  const actual =
    "0.1.0|/Users/seoksoonjang/dev/hql/hlvm|203277202|1773000000000";
  assertEquals(areRuntimeHostBuildIdsCompatible(expected, actual), true);
});

Deno.test("areRuntimeHostBuildIdsCompatible rejects mismatched artifact kinds or sizes", () => {
  const binary =
    "0.1.0|/Users/seoksoonjang/dev/hql/hlvm|203277202|1773059460285";
  const source =
    "0.1.0|/Users/seoksoonjang/dev/hql/src/hlvm/cli/cli.ts|203277202|1773059460285";
  const wrongSize =
    "0.1.0|/Users/seoksoonjang/dev/hql/hlvm|203277111|1773059460285";

  assertEquals(areRuntimeHostBuildIdsCompatible(binary, source), false);
  assertEquals(areRuntimeHostBuildIdsCompatible(binary, wrongSize), false);
});
