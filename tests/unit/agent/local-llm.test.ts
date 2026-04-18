import { assertEquals } from "jsr:@std/assert";
import {
  classifyBrowserFinalAnswer,
  classifyFactConflicts,
  classifyGroundedness,
  classifyPlanNeed,
  classifyRequestPhase,
  classifySourceAuthorities,
  classifyTask,
  classifyToolSafety,
  extractJson,
  getLocalModelDisplayName,
} from "../../../src/hlvm/runtime/local-llm.ts";
import { LOCAL_FALLBACK_MODEL_ID } from "../../../src/hlvm/runtime/local-fallback.ts";
import { DEFAULT_MODEL_ID } from "../../../src/common/config/types.ts";
import { ai } from "../../../src/hlvm/api/ai.ts";
import { log } from "../../../src/hlvm/api/log.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

function setAiChatStub(
  stub: typeof ai.chat,
): () => void {
  const original = ai.chat;
  (ai as { chat: typeof ai.chat }).chat = stub;
  return () => {
    (ai as { chat: typeof ai.chat }).chat = original;
  };
}

function captureLogs(): {
  debugs: string[];
  warnings: string[];
  restore: () => void;
} {
  const debugs: string[] = [];
  const warnings: string[] = [];
  const originalDebug = log.debug;
  const originalWarn = log.warn;
  (log as { debug: typeof log.debug }).debug = (
    message: string,
    ...args: unknown[]
  ) => {
    debugs.push([message, ...args].map(String).join(" "));
  };
  (log as { warn: typeof log.warn }).warn = (
    message: string,
    ...args: unknown[]
  ) => {
    warnings.push([message, ...args].map(String).join(" "));
  };
  return {
    debugs,
    warnings,
    restore: () => {
      (log as { debug: typeof log.debug }).debug = originalDebug;
      (log as { warn: typeof log.warn }).warn = originalWarn;
    },
  };
}

async function withLocalAiEnabled(
  fn: () => Promise<void>,
): Promise<void> {
  const platform = getPlatform();
  const previous = platform.env.get("HLVM_DISABLE_AI_AUTOSTART");
  platform.env.delete("HLVM_DISABLE_AI_AUTOSTART");
  try {
    await fn();
  } finally {
    if (previous === undefined) {
      platform.env.delete("HLVM_DISABLE_AI_AUTOSTART");
    } else {
      platform.env.set("HLVM_DISABLE_AI_AUTOSTART", previous);
    }
  }
}

Deno.test("getLocalModelDisplayName: derives from LOCAL_FALLBACK_MODEL_ID", () => {
  const name = getLocalModelDisplayName();
  const expected = (() => {
    const raw = LOCAL_FALLBACK_MODEL_ID.split("/").pop() ?? "";
    const base = raw.split(":")[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  })();
  assertEquals(name, expected);
});

Deno.test("getLocalModelDisplayName: no hardcoded 'Gemma 4'", () => {
  const name = getLocalModelDisplayName();
  assertEquals(name.includes("Gemma 4"), false);
});

Deno.test("getLocalModelDisplayName: capitalized, no provider prefix, no tag", () => {
  const name = getLocalModelDisplayName();
  assertEquals(name[0], name[0].toUpperCase());
  assertEquals(name.includes("/"), false);
  assertEquals(name.includes(":"), false);
});

Deno.test("DEFAULT_MODEL_ID derives from LOCAL_FALLBACK_MODEL_ID", () => {
  assertEquals(DEFAULT_MODEL_ID, LOCAL_FALLBACK_MODEL_ID);
});

Deno.test("extractJson: clean JSON object", () => {
  assertEquals(extractJson('{"code":true}'), '{"code":true}');
});

Deno.test("extractJson: JSON with preamble", () => {
  const input = 'Here is the classification: {"code":true,"reasoning":false}';
  assertEquals(extractJson(input), '{"code":true,"reasoning":false}');
});

Deno.test("extractJson: JSON in markdown fences", () => {
  const input = '```json\n{"code":false}\n```';
  assertEquals(extractJson(input), '{"code":false}');
});

Deno.test("extractJson: no JSON returns empty object", () => {
  assertEquals(extractJson("just some text"), "{}");
});

Deno.test("extractJson: empty string returns empty object", () => {
  assertEquals(extractJson(""), "{}");
});

Deno.test("extractJson: only first object extracted", () => {
  const input = '{"a":1} and {"b":2}';
  assertEquals(extractJson(input), '{"a":1}');
});

Deno.test("extractJson: nested JSON object", () => {
  const input = '{"a":{"b":1}}';
  assertEquals(extractJson(input), '{"a":{"b":1}}');
});

Deno.test("extractJson: unmatched open brace returns empty", () => {
  assertEquals(extractJson("{unclosed"), "{}");
});

Deno.test("classifyTask: empty query returns defaults", async () => {
  const result = await classifyTask("");
  assertEquals(result.isCodeTask, false);
  assertEquals(result.isReasoningTask, false);
  assertEquals(result.needsStructuredOutput, false);
});

Deno.test("classifyTask: whitespace-only returns defaults", async () => {
  const result = await classifyTask("   ");
  assertEquals(result.isCodeTask, false);
  assertEquals(result.isReasoningTask, false);
  assertEquals(result.needsStructuredOutput, false);
});

Deno.test("classifyPlanNeed: empty query returns defaults", async () => {
  const result = await classifyPlanNeed("");
  assertEquals(result.needsPlan, false);
});

Deno.test("classifyPlanNeed: whitespace-only returns defaults", async () => {
  const result = await classifyPlanNeed("   ");
  assertEquals(result.needsPlan, false);
});

Deno.test("classifyRequestPhase: empty query returns researching", async () => {
  const result = await classifyRequestPhase("");
  assertEquals(result.phase, "researching");
});

Deno.test("classifyFactConflicts: empty new fact returns defaults", async () => {
  const result = await classifyFactConflicts("", ["old fact"]);
  assertEquals(result.conflicts.length, 0);
});

Deno.test("classifyFactConflicts: empty existing facts returns defaults", async () => {
  const result = await classifyFactConflicts("new fact", []);
  assertEquals(result.conflicts.length, 0);
});

Deno.test("classifyGroundedness: empty response returns defaults", async () => {
  const result = await classifyGroundedness("", "tool data");
  assertEquals(result.incorporatesData, false);
});

Deno.test("classifyGroundedness: whitespace-only returns defaults", async () => {
  const result = await classifyGroundedness("   ", "tool data");
  assertEquals(result.incorporatesData, false);
});

Deno.test("classifySourceAuthorities: empty results returns defaults", async () => {
  const result = await classifySourceAuthorities([]);
  assertEquals(result.results.length, 0);
});

Deno.test("classifyBrowserFinalAnswer: empty response returns incomplete", async () => {
  const result = await classifyBrowserFinalAnswer(
    "Download the latest installer",
    "",
  );
  assertEquals(result.isComplete, false);
});

Deno.test("classifyTask: runtime failure returns defaults and records warning diagnostics", async () => {
  await withLocalAiEnabled(async () => {
    const restoreChat = setAiChatStub(async function* (_messages, _options) {
      throw new Error("runtime exploded");
    });
    const captured = captureLogs();
    try {
      const result = await classifyTask("write a parser");
      assertEquals(result.isCodeTask, false);
      assertEquals(result.isReasoningTask, false);
      assertEquals(result.needsStructuredOutput, false);
      assertEquals(
        captured.warnings.some((message) =>
          message.includes("runtime_error") &&
          message.includes("runtime exploded")
        ),
        true,
      );
    } finally {
      captured.restore();
      restoreChat();
    }
  });
});

Deno.test("classifyTask: parse failure returns defaults and records warning diagnostics", async () => {
  await withLocalAiEnabled(async () => {
    const restoreChat = setAiChatStub(async function* (_messages, _options) {
      yield "{invalid}";
    });
    const captured = captureLogs();
    try {
      const result = await classifyTask("write a parser");
      assertEquals(result.isCodeTask, false);
      assertEquals(result.isReasoningTask, false);
      assertEquals(result.needsStructuredOutput, false);
      assertEquals(
        captured.warnings.some((message) => message.includes("parse_failure")),
        true,
      );
    } finally {
      captured.restore();
      restoreChat();
    }
  });
});

Deno.test("classifyRequestPhase: parses valid phase JSON", async () => {
  await withLocalAiEnabled(async () => {
    const restoreChat = setAiChatStub(async function* (_messages, _options) {
      yield '{"phase":"verifying"}';
    });
    try {
      const result = await classifyRequestPhase("run the test suite");
      assertEquals(result.phase, "verifying");
    } finally {
      restoreChat();
    }
  });
});

Deno.test("classifyRequestPhase: runtime failure falls back deterministically", async () => {
  await withLocalAiEnabled(async () => {
    const restoreChat = setAiChatStub(async function* (_messages, _options) {
      throw new Error("runtime exploded");
    });
    try {
      const result = await classifyRequestPhase("fix the parser bug");
      assertEquals(result.phase, "editing");
    } finally {
      restoreChat();
    }
  });
});

Deno.test("classifyToolSafety: runtime failure stays fail-closed", async () => {
  await withLocalAiEnabled(async () => {
    const restoreChat = setAiChatStub(async function* (_messages, _options) {
      throw new Error("runtime exploded");
    });
    try {
      const result = await classifyToolSafety("write_file", {
        path: "src/main.ts",
      });
      assertEquals(result.safe, false);
      assertEquals(result.reason, "classification failed");
    } finally {
      restoreChat();
    }
  });
});
