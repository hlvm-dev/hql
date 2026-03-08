import { assertEquals } from "jsr:@std/assert";
import {
  resolveSessionStart,
  SESSION_PICKER_LIMIT,
} from "../../../src/hlvm/cli/repl/session/start.ts";
import type { SessionMeta } from "../../../src/hlvm/cli/repl/session/types.ts";

function createSession(id: string): SessionMeta {
  return {
    id,
    title: `Session ${id}`,
    createdAt: 0,
    updatedAt: 0,
    messageCount: 0,
    metadata: null,
  };
}

Deno.test("session start: picker returns the picker session list", async () => {
  const sessions = [createSession("picker-1"), createSession("picker-2")];
  let capturedLimit = 0;

  const result = await resolveSessionStart({ openPicker: true }, {
    listSessions: async (options) => {
      capturedLimit = options?.limit ?? 0;
      return sessions;
    },
    hasSession: async () => true,
  });

  assertEquals(capturedLimit, SESSION_PICKER_LIMIT);
  assertEquals(result, { kind: "picker", sessions });
});

Deno.test("session start: resume validates existence once", async () => {
  const existing = await resolveSessionStart({ resumeId: "resume-me" }, {
    listSessions: async () => [],
    hasSession: async (sessionId) => sessionId === "resume-me",
  });
  assertEquals(existing, { kind: "resume", sessionId: "resume-me" });

  const missing = await resolveSessionStart({ resumeId: "missing" }, {
    listSessions: async () => [],
    hasSession: async () => false,
  });
  assertEquals(missing, { kind: "missing", sessionId: "missing" });
});

Deno.test("session start: --new wins over latest lookup", async () => {
  const result = await resolveSessionStart({ forceNew: true }, {
    listSessions: async () => [createSession("latest")],
    hasSession: async () => true,
  });
  assertEquals(result, { kind: "new" });
});

Deno.test("session start: explicit --new wins over conflicting resume flags", async () => {
  const result = await resolveSessionStart({
    forceNew: true,
    resumeId: "resume-me",
    openPicker: true,
  }, {
    listSessions: async () => [createSession("latest")],
    hasSession: async () => true,
  });
  assertEquals(result, { kind: "new" });
});

Deno.test("session start: default path resolves latest session or null", async () => {
  const latest = await resolveSessionStart({}, {
    listSessions: async () => [createSession("latest")],
    hasSession: async () => true,
  });
  assertEquals(latest, { kind: "latest", sessionId: "latest" });

  const none = await resolveSessionStart({}, {
    listSessions: async () => [],
    hasSession: async () => true,
  });
  assertEquals(none, { kind: "latest", sessionId: null });
});
