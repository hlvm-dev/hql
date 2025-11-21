import { assert, assertEquals } from "@std/assert";
import { REPL } from "../mod.ts";
import type { CompletionItem, REPLPlugin } from "../src/plugin-interface.ts";
import { SimpleReadline } from "../src/simple-readline.ts";

const jsPlugin: REPLPlugin = {
  name: "JavaScript",
  async evaluate(code, context) {
    const exportName = `__repl_line_${context.lineNumber}`;
    await context.appendToModule(`export const ${exportName} = (${code});\n`);
    const module = await context.reimportModule<Record<string, unknown>>();
    return { value: module[exportName] };
  },
};

Deno.test("shared module state persists across evaluations", async () => {
  const repl = new REPL([jsPlugin]);
  const first = await repl.evaluate("1 + 2");
  assertEquals(first?.value, 3);

  const second = await repl.evaluate("5 + 2");
  assertEquals(second?.value, 7);

  await repl.dispose();
});

Deno.test("line numbers increment per evaluation", async () => {
  const observed: number[] = [];
  const trackingPlugin: REPLPlugin = {
    name: "Tracker",
    async evaluate(code, context) {
      observed.push(context.lineNumber);
      await context.appendToModule(`export const __repl_line_${context.lineNumber} = (${code});\n`);
      await context.reimportModule();
      return { value: context.lineNumber };
    },
  };

  const repl = new REPL([trackingPlugin]);
  await repl.evaluate("1");
  await repl.evaluate("2");
  assert(observed.length === 2);
  assert(observed[1] === observed[0] + 1);
  await repl.dispose();
});

Deno.test("plugin state persists", async () => {
  const stateful: REPLPlugin = {
    name: "State",
    async evaluate(_, context) {
      const count = (context.getState<number>("count") ?? 0) + 1;
      context.setState("count", count);
      return { value: count };
    },
  };

  const repl = new REPL([stateful]);
  const first = await repl.evaluate("noop");
  const second = await repl.evaluate("noop");
  assertEquals(first?.value, 1);
  assertEquals(second?.value, 2);
  await repl.dispose();
});

Deno.test("module writes roll back on evaluation error", async () => {
  let modulePath = "";
  const failing: REPLPlugin = {
    name: "Failer",
    init(context) {
      modulePath = context.modulePath;
    },
    async evaluate(code, context) {
      await context.appendToModule(`export const broken = (${code});\n`);
      throw new Error("boom");
    },
  };

  const repl = new REPL([failing]);
  await repl.evaluate("1 + 2");
  assert(modulePath.length > 0);
  const contents = await Deno.readTextFile(modulePath);
  assert(!contents.includes("broken"));
  await repl.dispose();
});

Deno.test("completions index evaluated identifiers", async () => {
  const repl = new REPL([jsPlugin]);
  (repl as any).ingestCompletionTokens("const magicResult = 42");
  const suggestions = await (repl as any).provideCompletions({
    line: "magic",
    cursor: 5,
    prefix: "magic",
  });
  assert(Array.isArray(suggestions));
  assert(suggestions.some((item: { label: string }) => item.label === "magicResult"));
  await repl.dispose();
});

Deno.test("snippet completions surface without requiring a prefix", async () => {
  const snippetPlugin: REPLPlugin = {
    name: "Snippet",
    getCompletions() {
      return [{
        label: "fn",
        detail: "snippet",
        snippet: "fn ${1:name} [${2:args}] ${3:body})",
      }];
    },
    async evaluate() {
      return { suppressOutput: true };
    },
  };

  const repl = new REPL([snippetPlugin]);
  const completions = await (repl as any).provideCompletions({
    line: "(",
    cursor: 1,
    prefix: "",
  });

  assert(completions.some((item: CompletionItem) => item.snippet?.includes("${1:name}")));
  await repl.dispose();
});

Deno.test("snippet expansion removes placeholders and preserves caret location", () => {
  const reader = new SimpleReadline();
  const helper = reader as unknown as {
    expandSnippet(snippet: string): { text: string; cursor: number };
  };

  const { text, cursor } = helper.expandSnippet("fn ${1:name} [${2:args}] ${3:body})");
  assertEquals(text, "fn name [args] body)");
  assertEquals(cursor, "fn ".length);
});

Deno.test("respects custom temp directory prefix", async () => {
  const repl = new REPL([jsPlugin], { tempDirPrefix: "custom-repl-" });
  await repl.init();
  const tempDir = (repl as any).tempDir as string;
  assert(tempDir.includes("custom-repl-"));
  await repl.dispose();
});

Deno.test("simple readline highlights configured keywords", () => {
  const reader = new SimpleReadline(["foo"]);
  const highlight = (reader as any).highlightSyntax("foo bar");
  assertEquals(highlight, "\x1b[38;2;128;54;146mfoo\x1b[0m bar");

  reader.setKeywords([]);
  const without = (reader as any).highlightSyntax("foo bar");
  assertEquals(without, "foo bar");
});

Deno.test("right arrow accepts ghost text at end of line", async () => {
  const reader = new SimpleReadline();
  const helper = reader as unknown as {
    currentLine: string;
    cursorPos: number;
    completionSession: {
      suggestions: CompletionItem[];
      index: number;
      base: string;
      suffix: string;
    } | null;
    previewLength: number;
    acceptCompletion(): Promise<void>;
    handleEscapeSequence(bytes: Uint8Array): Promise<boolean>;
  };

  helper.currentLine = "(f";
  helper.cursorPos = helper.currentLine.length;
  helper.completionSession = {
    suggestions: [{ label: "fn" }],
    index: 0,
    base: "",
    suffix: "",
  };
  helper.previewLength = 1;

  let accepted = false;
  helper.acceptCompletion = async () => {
    accepted = true;
  };

  const handled = await helper.handleEscapeSequence(new TextEncoder().encode("\x1b[C"));
  assert(handled);
  assert(accepted);
});

Deno.test("reverse search helper finds matches", () => {
  const reader = new SimpleReadline();
  const helper = reader as any;
  for (const line of ["(let x 1)", "(fn add [x y] (+ x y))", "(let user (await fetch))"]) {
    helper.pushHistory(line);
  }
  const first = helper["findReverseMatch"]("let", helper.getHistoryLength());
  assertEquals(first.value, "(let user (await fetch))");
  const second = helper["findReverseMatch"]("let", first.index);
  assertEquals(second.value, "(let x 1)");
});

Deno.test("save command writes history to file", async () => {
  const tempFile = await Deno.makeTempFile();
  try {
    const repl = new REPL([jsPlugin]);
    await repl.init();
    (repl as any).rl = {
      getHistory: () => ["(let x 1)", "(fn add [x y] (+ x y))"],
    };
    const commands = (repl as any).composeCommands();
    await (repl as any).handleInputLine(`.save ${tempFile}`, commands);
    const contents = await Deno.readTextFile(tempFile);
    assertEquals(contents.trim(), "(let x 1)\n(fn add [x y] (+ x y))".trim());
  } finally {
    await Deno.remove(tempFile).catch(() => {});
  }
});

Deno.test("editor command uses injected launcher and executes code", async () => {
  const captured: string[] = [];
  const plugin: REPLPlugin = {
    name: "Logger",
    detect: () => 100,
    async evaluate(code) {
      captured.push(code);
      return { suppressOutput: true };
    },
  };

  const repl = new REPL([plugin], {
    editorLauncher: async (file: string) => {
      await Deno.writeTextFile(file, "(+ 1 2)");
    },
  });
  await repl.init();
  const commands = (repl as any).composeCommands();
  await (repl as any).handleInputLine(".editor", commands);
  assert(captured.some((code) => code.trim() === "(+ 1 2)"));
});
