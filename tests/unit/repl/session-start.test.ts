import { assertEquals } from "jsr:@std/assert";
import {
  resolveSessionStart,
  type SessionStartResolverDeps,
} from "../../../src/hlvm/cli/repl/session/start.ts";

function createDeps(sessionIds: string[]): SessionStartResolverDeps {
  return {
    listSessions: async () =>
      sessionIds.map((id, index) => ({
        id,
        title: `Session ${index + 1}`,
        createdAt: index,
        updatedAt: index,
        messageCount: 0,
        metadata: null,
      })),
    hasSession: async (sessionId: string) => sessionIds.includes(sessionId),
  };
}

Deno.test("resolveSessionStart: defaults to latest session when no override is provided", async () => {
  const resolution = await resolveSessionStart(
    undefined,
    createDeps([
      "sess-latest",
    ]),
  );

  assertEquals(resolution, {
    kind: "latest",
    sessionId: "sess-latest",
  });
});

Deno.test("resolveSessionStart: REPL can default to a new session", async () => {
  const resolution = await resolveSessionStart(
    undefined,
    createDeps(["sess-latest"]),
    { defaultBehavior: "new" },
  );

  assertEquals(resolution, { kind: "new" });
});

Deno.test("resolveSessionStart: explicit continue overrides REPL fresh-session default", async () => {
  const resolution = await resolveSessionStart(
    { continue: true },
    createDeps(["sess-latest"]),
    { defaultBehavior: "new" },
  );

  assertEquals(resolution, {
    kind: "latest",
    sessionId: "sess-latest",
  });
});
