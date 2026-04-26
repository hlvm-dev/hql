import { assertEquals, assertThrows } from "jsr:@std/assert";
import { flushChannelDiagnostics } from "../../../src/hlvm/channels/core/trace.ts";
import {
  completeGuiChannelTurn,
  requestGuiChannelTurn,
  subscribeGuiChannelTurns,
} from "../../../src/hlvm/channels/core/gui-turn-bridge.ts";

Deno.test("gui channel turn bridge resolves completed GUI response", async () => {
  let requestId = "";
  const unsubscribe = subscribeGuiChannelTurns((request) => {
    requestId = request.request_id;
    assertEquals(request.channel, "telegram");
    assertEquals(request.remote_id, "remote-1");
    assertEquals(request.text, "hello");
  });
  try {
    const resultPromise = requestGuiChannelTurn({
      query: "hello",
      channel: "telegram",
      remoteId: "remote-1",
      sessionId: "channel:telegram:remote-1",
    });
    assertEquals(completeGuiChannelTurn(requestId, "hi back"), true);
    assertEquals(await resultPromise, { text: "hi back" });
  } finally {
    unsubscribe();
    await flushChannelDiagnostics();
  }
});

Deno.test("gui channel turn bridge rejects when GUI is not connected", async () => {
  assertThrows(
    () =>
      requestGuiChannelTurn({
        query: "hello",
        channel: "telegram",
        remoteId: "remote-1",
        sessionId: "channel:telegram:remote-1",
      }),
    Error,
    "HLVM GUI is not connected",
  );
  await flushChannelDiagnostics();
});
