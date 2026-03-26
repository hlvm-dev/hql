import {
  assert,
  assertEquals,
} from "jsr:@std/assert";
import {
  formatErrorCode,
  getErrorFixes,
  HLVMErrorCode,
  HQLErrorCode,
  isHLVMErrorCode,
  isProviderErrorCode,
  parseErrorCodeFromMessage,
  ProviderErrorCode,
  stripErrorCodeFromMessage,
} from "../../../src/common/error-codes.ts";

Deno.test("error code formatting uses domain prefixes", () => {
  assertEquals(formatErrorCode(HQLErrorCode.UNDEFINED_VARIABLE), "HQL5001");
  assertEquals(formatErrorCode(HLVMErrorCode.REQUEST_TOO_LARGE), "HLVM5008");
  assertEquals(
    formatErrorCode(HLVMErrorCode.AI_ENGINE_STARTUP_FAILED),
    "HLVM5011",
  );
  assertEquals(formatErrorCode(ProviderErrorCode.AUTH_FAILED), "PRV9004");
});

Deno.test("error code parsing extracts domain-prefixed code", () => {
  assertEquals(
    parseErrorCodeFromMessage("[HQL5001] Request failed: value not defined"),
    HQLErrorCode.UNDEFINED_VARIABLE,
  );
  assertEquals(
    parseErrorCodeFromMessage("[HLVM5010] Runtime transport closed"),
    HLVMErrorCode.STREAM_ERROR,
  );
  assertEquals(
    parseErrorCodeFromMessage("[HLVM5011] AI engine failed to start"),
    HLVMErrorCode.AI_ENGINE_STARTUP_FAILED,
  );
  assertEquals(
    parseErrorCodeFromMessage("[PRV9008] Provider timeout"),
    ProviderErrorCode.REQUEST_TIMEOUT,
  );
});

Deno.test("error code parsing rejects invalid prefixes", () => {
  const parsedHql = parseErrorCodeFromMessage("[HQL5008] moved");
  const parsedHlvm = parseErrorCodeFromMessage("[HLVM5008] moved");
  const parsedPrv = parseErrorCodeFromMessage("[PRV9003] moved");

  assert(parsedHql === null);
  assert(parsedHlvm === HLVMErrorCode.REQUEST_TOO_LARGE);
  assert(parsedPrv === ProviderErrorCode.REQUEST_TOO_LARGE);
});

Deno.test("error helpers resolve per-domain fixes", () => {
  const fixHint = getErrorFixes(HLVMErrorCode.REQUEST_FAILED);
  assert(fixHint.length > 0);
  assertEquals(isHLVMErrorCode(HLVMErrorCode.REQUEST_FAILED), true);
  assertEquals(isProviderErrorCode(ProviderErrorCode.AUTH_FAILED), true);
});

Deno.test("stripErrorCodeFromMessage removes a prefix", () => {
  assertEquals(
    stripErrorCodeFromMessage("[PRV9004] API key is missing"),
    "API key is missing",
  );
});

Deno.test("error code formatting falls back to UNK for unknown domains", () => {
  const unknownCode = 12345 as never;
  assertEquals(formatErrorCode(unknownCode), "UNK12345");
});

Deno.test("error code numeric ranges remain disjoint across domains", () => {
  const hqlCodes = new Set(
    (Object.values(HQLErrorCode) as Array<number | string>).filter((value): value is number =>
      typeof value === "number"
    ),
  );
  const hlvmCodes = new Set(
    (Object.values(HLVMErrorCode) as Array<number | string>).filter((value): value is number =>
      typeof value === "number"
    ),
  );
  const providerCodes = new Set(
    (Object.values(ProviderErrorCode) as Array<number | string>).filter((value): value is number =>
      typeof value === "number"
    ),
  );

  for (const code of hqlCodes) {
    assert(!hlvmCodes.has(code));
    assert(!providerCodes.has(code));
  }
  for (const code of hlvmCodes) {
    assert(!providerCodes.has(code));
  }
});
