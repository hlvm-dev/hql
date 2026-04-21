import { assert, assertEquals } from "jsr:@std/assert";

// Sanity: since the handler reads the channelRuntime singleton, we
// can't easily isolate without a Deno-level import mock. We verify
// request-shape validation + basic response contract. Core runtime
// behavior is covered by core-pair-code.test.ts.
import {
  handleArmPairCode,
  handleDisarmPairCode,
} from "../../../src/hlvm/cli/repl/handlers/channels/pair-code.ts";

function jsonRequest(body: unknown): Request {
  return new Request("http://test.local/api/channels/x/arm-pair-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("handleArmPairCode: missing :channel path param → 400", async () => {
  const res = await handleArmPairCode(
    jsonRequest({ code: "1234" }),
    {} as any,
  );
  assertEquals(res.status, 400);
});

Deno.test("handleArmPairCode: unknown channel → 404", async () => {
  const res = await handleArmPairCode(
    jsonRequest({ code: "1234" }),
    { channel: "nonexistent-channel-xyz" } as any,
  );
  assertEquals(res.status, 404);
  const body = await res.json();
  assert(typeof body.error === "string" && body.error.includes("nonexistent"));
});

Deno.test("handleArmPairCode: malformed JSON → 4xx", async () => {
  const req = new Request("http://test.local/api/channels/x/arm-pair-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not-json",
  });
  const res = await handleArmPairCode(req, { channel: "messages" } as any);
  assert(res.status >= 400 && res.status < 500);
});

Deno.test("handleDisarmPairCode: missing :channel path param → 400", () => {
  const res = handleDisarmPairCode(
    new Request("http://test.local/"),
    {} as any,
  );
  assertEquals(res.status, 400);
});

Deno.test("handleDisarmPairCode: known or unknown channel → 200 (idempotent)", () => {
  // Disarm is always safe — the runtime's delete on an absent key is a
  // no-op, and the handler doesn't validate channel existence because
  // disarm-without-arm is harmless.
  const res = handleDisarmPairCode(
    new Request("http://test.local/"),
    { channel: "any-channel" } as any,
  );
  assertEquals(res.status, 200);
});
