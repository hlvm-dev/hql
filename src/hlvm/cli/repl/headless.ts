/**
 * Headless REPL - Non-interactive stdin runner
 * Used when stdin is not a TTY (e.g., tests or piped input).
 */

import { evaluate } from "./evaluator.ts";
import { formatValue } from "./formatter.ts";
import { ReplState } from "./state.ts";
import { registerApis } from "../../api/index.ts";
import { registerReplHelpers } from "./helpers.ts";
import { memory } from "../../api/memory.ts";
import { config } from "../../api/config.ts";

export interface HeadlessReplOptions {
  jsMode?: boolean;
  showBanner?: boolean;
}

export async function startHeadlessRepl(options: HeadlessReplOptions = {}): Promise<number> {
  const { jsMode = false, showBanner = true } = options;
  const state = new ReplState();

  try {
    await config.reload();
  } catch {
    // Ignore config load failures; defaults will be used.
  }

  const historyInit = state.initHistory();

  registerApis({
    replState: state,
    runtime: {
      getDocstrings: () => state.getDocstrings(),
      getSignatures: () => state.getSignatures(),
    },
  });

  const loadErrors: string[] = [];
  try {
    await memory.compact();
    state.setLoadingMemory(true);
    const result = await memory.load(async (code: string) => {
      const evalResult = await evaluate(code, state, jsMode);
      return { success: evalResult.success, error: evalResult.error };
    });
    state.setLoadingMemory(false);
    if (result.docstrings.size > 0) {
      state.addDocstrings(result.docstrings);
    }
    if (result.errors.length > 0) {
      loadErrors.push(...result.errors);
    }
  } catch {
    state.setLoadingMemory(false);
  }

  registerReplHelpers(state);

  await historyInit;

  if (showBanner) {
    await printBanner(loadErrors);
  }

  await runHeadlessLoop(state, jsMode);

  await state.flushHistory();
  state.flushHistorySync();

  return 0;
}

async function printBanner(loadErrors: string[]): Promise<void> {
  console.log("HLVM REPL");
  const memoryNames = await memory.list();
  const memoryDisplay = memoryNames.length > 0
    ? memoryNames.length <= 5
      ? memoryNames.join(", ")
      : `${memoryNames.slice(0, 5).join(", ")}... +${memoryNames.length - 5} more`
    : "empty - def/defn auto-save here";

  if (memoryNames.length > 0) {
    console.log(`Memory: ${memoryDisplay} (${memoryNames.length} definition${memoryNames.length === 1 ? "" : "s"})`);
  } else {
    console.log(`Memory: ${memoryDisplay}`);
  }

  console.log("AI: not available - install @hlvm/ai");
  console.log('(memory) | (forget "x") | (inspect x) | (describe x) AI | (help)');

  if (loadErrors.length > 0) {
    console.log("Memory warnings:");
    for (const err of loadErrors.slice(0, 3)) {
      console.log(`  ${err}`);
    }
    if (loadErrors.length > 3) {
      console.log(`  ... and ${loadErrors.length - 3} more`);
    }
  }
}

async function runHeadlessLoop(state: ReplState, jsMode: boolean): Promise<void> {
  const decoder = new TextDecoder();
  const buffer = new Uint8Array(1024);
  let pending = "";

  while (true) {
    const read = await Deno.stdin.read(buffer);
    if (read === null) {
      if (pending.length > 0) {
        await handleLine(pending, state, jsMode);
      }
      break;
    }

    pending += decoder.decode(buffer.subarray(0, read));

    while (true) {
      const newlineIndex = pending.indexOf("\n");
      if (newlineIndex === -1) break;
      const line = pending.slice(0, newlineIndex).replace(/\r$/, "");
      pending = pending.slice(newlineIndex + 1);
      await handleLine(line, state, jsMode);
    }
  }
}

async function handleLine(line: string, state: ReplState, jsMode: boolean): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;

  state.addHistory(trimmed);

  const result = await evaluate(trimmed, state, jsMode);
  if (result.suppressOutput) return;

  if (!result.success) {
    if (result.error) {
      console.error(`${result.error.name}: ${result.error.message}`);
    }
    return;
  }

  if (result.streamTaskId) {
    console.log("[streaming output]");
    return;
  }

  if (result.value && typeof result.value === "object" && Symbol.asyncIterator in result.value) {
    for await (const chunk of result.value as AsyncIterable<unknown>) {
      if (typeof chunk === "string") {
        console.log(chunk);
      } else {
        console.log(String(chunk));
      }
    }
    return;
  }

  if (result.isCommandOutput && typeof result.value === "string") {
    console.log(result.value);
    return;
  }

  const formatted = formatValue(result.value);
  if (formatted) {
    console.log(formatted);
  }
}
