import { assertEquals } from "jsr:@std/assert@1";
import {
  commitEvalOutcome,
  type EvalCommitState,
} from "../../../src/hlvm/cli/repl/evaluator.ts";

Deno.test("commitEvalOutcome persists before publishing bindings and functions", async () => {
  const calls: string[] = [];
  const state: EvalCommitState = {
    isLoadingBindings: false,
    addBinding(name: string) {
      calls.push(`bind:${name}`);
    },
    addFunction(name: string, params: string[]) {
      calls.push(`fn:${name}:${params.join(",")}`);
    },
    getDocstring(name: string) {
      return `doc:${name}`;
    },
  };

  await commitEvalOutcome(
    state,
    [
      {
        name: "answer",
        persist: {
          operator: "def",
          value: 42,
        },
      },
      {
        name: "greet",
        params: ["name"],
        persist: {
          operator: "defn",
          value: "(defn greet [name] name)",
        },
      },
    ],
    {
      appendBinding: async (
        name: string,
        operator: "def" | "defn",
        _value: unknown,
        docstring?: string,
      ) => {
        calls.push(`persist:${operator}:${name}:${docstring ?? ""}`);
      },
    },
  );

  assertEquals(calls, [
    "persist:def:answer:doc:answer",
    "persist:defn:greet:doc:greet",
    "bind:answer",
    "fn:greet:name",
  ]);
});

Deno.test("commitEvalOutcome skips persistence while bindings are loading but still updates state", async () => {
  const calls: string[] = [];
  const state: EvalCommitState = {
    isLoadingBindings: true,
    addBinding(name: string) {
      calls.push(`bind:${name}`);
    },
    addFunction(name: string, params: string[]) {
      calls.push(`fn:${name}:${params.join(",")}`);
    },
    getDocstring() {
      return undefined;
    },
  };

  await commitEvalOutcome(
    state,
    [
      {
        name: "loaded",
        persist: {
          operator: "def",
          value: 1,
        },
      },
      {
        name: "withParams",
        params: ["x"],
      },
    ],
    {
      appendBinding: async () => {
        calls.push("persisted");
      },
    },
  );

  assertEquals(calls, ["bind:loaded", "fn:withParams:x"]);
});
