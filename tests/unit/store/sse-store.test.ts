/**
 * SSE Store Tests
 *
 * Verifies in-memory ring buffer and pub/sub for Server-Sent Events.
 */

import { assertEquals } from "jsr:@std/assert";
import {
  pushSSEEvent,
  subscribe,
  replayAfter,
  clearSessionBuffer,
} from "../../../src/hlvm/store/sse-store.ts";

function uniqueSession(): string {
  return `test-${crypto.randomUUID()}`;
}

Deno.test({
  name: "SSE: pushSSEEvent - sequence increments",
  fn() {
    const sid = uniqueSession();
    const e1 = pushSSEEvent(sid, "message_added", { text: "Hello" });
    const e2 = pushSSEEvent(sid, "message_added", { text: "World" });

    assertEquals(e1.id, "1");
    assertEquals(e2.id, "2");
    assertEquals(e1.event_type, "message_added");
    assertEquals(e1.session_id, sid);

    clearSessionBuffer(sid);
  },
});

Deno.test({
  name: "SSE: subscribe - receives live events",
  fn() {
    const sid = uniqueSession();
    const received: string[] = [];

    const unsubscribe = subscribe(sid, (event) => {
      received.push(event.id);
    });

    pushSSEEvent(sid, "test", {});
    pushSSEEvent(sid, "test", {});

    assertEquals(received.length, 2);
    assertEquals(received[0], "1");
    assertEquals(received[1], "2");

    unsubscribe();
    pushSSEEvent(sid, "test", {});
    assertEquals(received.length, 2);

    clearSessionBuffer(sid);
  },
});

Deno.test({
  name: "SSE: replayAfter - null lastEventId returns all events",
  fn() {
    const sid = uniqueSession();
    pushSSEEvent(sid, "a", {});
    pushSSEEvent(sid, "b", {});

    const result = replayAfter(sid, null);
    assertEquals(result.gapDetected, false);
    assertEquals(result.events.length, 2);

    clearSessionBuffer(sid);
  },
});

Deno.test({
  name: "SSE: replayAfter - valid lastEventId returns newer events",
  fn() {
    const sid = uniqueSession();
    pushSSEEvent(sid, "a", {});
    pushSSEEvent(sid, "b", {});
    pushSSEEvent(sid, "c", {});

    const result = replayAfter(sid, "1");
    assertEquals(result.gapDetected, false);
    assertEquals(result.events.length, 2);
    assertEquals(result.events[0].id, "2");
    assertEquals(result.events[1].id, "3");

    clearSessionBuffer(sid);
  },
});

Deno.test({
  name: "SSE: replayAfter - gap detection when lastEventId < buffer start",
  fn() {
    const sid = uniqueSession();

    for (let i = 0; i < 1030; i++) {
      pushSSEEvent(sid, "fill", { i });
    }

    const result = replayAfter(sid, "1");
    assertEquals(result.gapDetected, true);
    assertEquals(result.events.length, 0);

    clearSessionBuffer(sid);
  },
});

Deno.test({
  name: "SSE: buffer overflow - oldest events evicted beyond 1024",
  fn() {
    const sid = uniqueSession();

    for (let i = 0; i < 1030; i++) {
      pushSSEEvent(sid, "fill", { i });
    }

    const result = replayAfter(sid, null);
    assertEquals(result.events.length, 1024);
    assertEquals(parseInt(result.events[0].id, 10), 7);

    clearSessionBuffer(sid);
  },
});

Deno.test({
  name: "SSE: clearSessionBuffer - resets everything",
  fn() {
    const sid = uniqueSession();
    pushSSEEvent(sid, "test", {});
    pushSSEEvent(sid, "test", {});

    clearSessionBuffer(sid);

    const result = replayAfter(sid, null);
    assertEquals(result.events.length, 0);

    const e = pushSSEEvent(sid, "after-clear", {});
    assertEquals(e.id, "1");

    clearSessionBuffer(sid);
  },
});
