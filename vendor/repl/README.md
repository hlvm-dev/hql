# Pure REPL

Language-agnostic REPL core used by HLVM and HQL. The core only handles input, history, and execution context. Languages integrate via plugins that wrap real transpilers (HQL, TypeScript, ClojureScript, etc.).

## Quick Start

```bash
den o task test
```

```ts
import { REPL } from "@hlvm/repl";
import type { REPLPlugin } from "@hlvm/repl";

const jsPlugin: REPLPlugin = {
  name: "JavaScript",
  async evaluate(code, context) {
    await context.appendToModule(`export const __repl_line_${context.lineNumber} = (${code});\n`);
    const module = await context.reimportModule();
    return { value: module[`__repl_line_${context.lineNumber}`] };
  },
};

const repl = new REPL([jsPlugin], { prompt: "> " });
await repl.start();
```

## Commands

- `.help` – show help
- `.clear` – clear terminal
- `.reset` – reset module state
- `close()` – exit REPL

## License

MIT
