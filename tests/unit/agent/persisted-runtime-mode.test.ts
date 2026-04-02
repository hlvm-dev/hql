import { assertEquals } from "jsr:@std/assert";
import { parsePersistedAgentSessionMetadata } from "../../../src/hlvm/agent/persisted-transcript.ts";

Deno.test("persisted transcript metadata: parses stored runtime mode", () => {
  const metadata = parsePersistedAgentSessionMetadata(
    JSON.stringify({
      agentSession: {
        runtimeMode: "auto",
      },
    }),
  );

  assertEquals(metadata.runtimeMode, "auto");
});

Deno.test("persisted transcript metadata: ignores invalid runtime mode values", () => {
  const metadata = parsePersistedAgentSessionMetadata(
    JSON.stringify({
      agentSession: {
        runtimeMode: "invalid",
      },
    }),
  );

  assertEquals(metadata.runtimeMode, undefined);
});

Deno.test("persisted transcript metadata: parses last applied routing constraints", () => {
  const metadata = parsePersistedAgentSessionMetadata(
    JSON.stringify({
      agentSession: {
        lastAppliedRoutingConstraints: {
          hardConstraints: ["local-only"],
          preference: "cheap",
          preferenceConflict: false,
          source: "task-text",
        },
      },
    }),
  );

  assertEquals(metadata.lastAppliedRoutingConstraints, {
    hardConstraints: ["local-only"],
    preference: "cheap",
    preferenceConflict: false,
    source: "task-text",
  });
});

Deno.test("persisted transcript metadata: parses last applied turn context", () => {
  const metadata = parsePersistedAgentSessionMetadata(
    JSON.stringify({
      agentSession: {
        lastAppliedTurnContext: {
          attachmentCount: 2,
          attachmentKinds: ["image", "pdf"],
          visionEligibleAttachmentCount: 1,
          visionEligibleKinds: ["image"],
        },
      },
    }),
  );

  assertEquals(metadata.lastAppliedTurnContext, {
    attachmentCount: 2,
    attachmentKinds: ["image", "pdf"],
    visionEligibleAttachmentCount: 1,
    visionEligibleKinds: ["image"],
    audioEligibleAttachmentCount: 0,
    audioEligibleKinds: [],
  });
});

Deno.test("persisted transcript metadata: parses last applied task capability context", () => {
  const metadata = parsePersistedAgentSessionMetadata(
    JSON.stringify({
      agentSession: {
        lastAppliedTaskCapabilityContext: {
          requestedCapabilities: ["code.exec"],
          source: "task-text",
          matchedCueLabels: ["calculate", "base64"],
        },
      },
    }),
  );

  assertEquals(metadata.lastAppliedTaskCapabilityContext, {
    requestedCapabilities: ["code.exec"],
    source: "task-text",
    matchedCueLabels: ["base64", "calculate"],
  });
});
