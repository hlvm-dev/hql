import { getPlatform } from "../../src/platform/platform.ts";

const platform = getPlatform();
const [outputPath, behavior = "record"] = Deno.args;

if (!outputPath) {
  throw new Error("Usage: agent-hook-recorder.ts <output-path> [record|fail|sleep]");
}

if (behavior === "sleep") {
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

const payloadText = await new Response(Deno.stdin.readable).text();
await platform.fs.mkdir(platform.path.dirname(outputPath), { recursive: true });
await platform.fs.writeTextFile(
  outputPath,
  `${payloadText.trim()}\n`,
  { append: true, create: true },
);

if (behavior === "fail") {
  Deno.exit(1);
}
