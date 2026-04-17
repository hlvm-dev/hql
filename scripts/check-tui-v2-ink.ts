#!/usr/bin/env -S deno run --allow-run --allow-read
// Regression guard for the v2 TUI graph.
//
// History: a previous migration left v2 transitively importing v1 repl-ink
// files that used bare `from "ink"` imports. Bare `ink` resolved to
// `npm:ink@5`, which transitively pinned `react-reconciler@0.29.2`. React 19
// removed `ReactCurrentOwner`, which `react-reconciler@0.29` reads, so
// `./hlvm repl --new` crashed on boot with:
//
//   TypeError: Cannot read properties of undefined (reading 'ReactCurrentOwner')
//
// The fix was to remap the bare `"ink"` specifier in
// `src/hlvm/tui-v2/deno.json` to the local CC donor engine at
// `./ink/index.ts`. This script enforces that invariant by scanning the
// output of `deno info` for any reachable `npm:ink@5` or
// `react-reconciler@0.29.x` node in the v2 module graph. If either is found
// the script exits non-zero with the offending lines.
//
// Run via `deno run` directly or wire into CI / a Makefile target.

const FORBIDDEN_FRAGMENTS = [
  "npm:/ink@5",
  "npm:/react-reconciler@0.29",
];

async function main(): Promise<number> {
  const entry = new URL(
    "../src/hlvm/tui-v2/main.tsx",
    import.meta.url,
  ).pathname;
  const configPath = new URL(
    "../src/hlvm/tui-v2/deno.json",
    import.meta.url,
  ).pathname;

  const cmd = new Deno.Command("deno", {
    args: [
      "info",
      "--config",
      configPath,
      "--unstable-sloppy-imports",
      entry,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    console.error("deno info failed");
    await Deno.stderr.write(stderr);
    return 2;
  }

  const output = new TextDecoder().decode(stdout);
  const hits: string[] = [];
  for (const line of output.split("\n")) {
    for (const fragment of FORBIDDEN_FRAGMENTS) {
      if (line.includes(fragment)) {
        hits.push(line.trim());
        break;
      }
    }
  }

  if (hits.length === 0) {
    console.log(
      "v2 TUI graph is clean: no npm:ink@5 or react-reconciler@0.29 reachable from main.tsx",
    );
    return 0;
  }

  console.error(
    "REGRESSION: v2 TUI graph now includes a forbidden module.",
  );
  console.error(
    "This will re-introduce the ReactCurrentOwner crash on boot.",
  );
  console.error(
    "Likely cause: v2 imported a v1 repl-ink file that uses bare `from \"ink\"`,",
  );
  console.error(
    "or the `\"ink\"` specifier in src/hlvm/tui-v2/deno.json was changed",
  );
  console.error("back to `npm:ink@5`.");
  console.error("");
  console.error("Offending lines in `deno info` output:");
  for (const hit of hits.slice(0, 20)) {
    console.error("  " + hit);
  }
  return 1;
}

if (import.meta.main) {
  Deno.exit(await main());
}
