import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  findSymbol,
  getStructure,
  searchCode,
} from "../../../src/hlvm/agent/tools/code-tools.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

async function withWorkspace(fn: (workspace: string) => Promise<void>): Promise<void> {
  const platform = getPlatform();
  const workspace = await platform.fs.makeTempDir({ prefix: "hlvm-code-test-" });
  try {
    await seedWorkspace(workspace);
    await fn(workspace);
  } finally {
    await platform.fs.remove(workspace, { recursive: true });
  }
}

async function seedWorkspace(workspace: string): Promise<void> {
  const platform = getPlatform();
  const join = platform.path.join.bind(platform.path);

  await platform.fs.mkdir(join(workspace, "src", "components"), { recursive: true });
  await platform.fs.writeTextFile(
    join(workspace, "src", "main.ts"),
    `export class UserService {
  async validateUser(id: string): Promise<boolean> {
    return true;
  }
}

export const CONFIG = {
  apiUrl: "https://api.example.com"
};

export function processData(data: any[]): number {
  return data.length;
}
`,
  );
  await platform.fs.writeTextFile(
    join(workspace, "src", "utils.ts"),
    `export function validateEmail(email: string): boolean {
  return /^[^@]+@[^@]+$/.test(email);
}

export const DEFAULT_TIMEOUT = 5000;
`,
  );
  await platform.fs.writeTextFile(
    join(workspace, "src", "components", "Button.tsx"),
    `export class Button {
  render() {
    return "<button>Click</button>";
  }
}
`,
  );
  await platform.fs.writeTextFile(
    join(workspace, ".gitignore"),
    "node_modules\n*.log\n",
  );
}

Deno.test("CodeTools: searchCode finds matches and returns bounded context", async () => {
  await withWorkspace(async (workspace) => {
    const result = await searchCode({
      pattern: "validateUser",
      contextLines: 2,
    }, workspace);

    assertEquals(result.success, true);
    assertEquals(result.count, 1);
    assertEquals(result.matches?.[0].file.includes("main.ts"), true);
    assertEquals(result.matches?.[0].match, "validateUser");
    assertEquals(Array.isArray(result.matches?.[0].context), true);
    assertEquals((result.matches?.[0].context?.length ?? 0) <= 5, true);
  });
});

Deno.test("CodeTools: searchCode respects path filters, file filters, and result limits", async () => {
  await withWorkspace(async (workspace) => {
    const byPath = await searchCode({
      pattern: "validate",
      path: "src/utils.ts",
    }, workspace);
    const byPattern = await searchCode({
      pattern: "class",
      filePattern: "*.tsx",
    }, workspace);
    const limited = await searchCode({
      pattern: ".",
      maxResults: 1,
    }, workspace);

    assertEquals(byPath.success, true);
    assertEquals(byPath.matches?.every((match) => match.file.endsWith("utils.ts")), true);
    assertEquals(byPattern.success, true);
    assertEquals(byPattern.matches?.every((match) => match.file.endsWith(".tsx")), true);
    assertEquals(limited.success, true);
    assertEquals((limited.count ?? 0) <= 1, true);
    assertStringIncludes(limited.message ?? "", "limit");
  });
});

Deno.test("CodeTools: searchCode skips oversized files and reports zero matches cleanly", async () => {
  await withWorkspace(async (workspace) => {
    const platform = getPlatform();
    const largePath = platform.path.join(workspace, "src", "large.ts");
    await platform.fs.writeTextFile(
      largePath,
      `// UNIQUE_LARGE\n${"X".repeat(200)}`,
    );

    const oversized = await searchCode({
      pattern: "UNIQUE_LARGE",
      maxFileBytes: 10,
    }, workspace);
    const missing = await searchCode({ pattern: "nonexistentpattern12345" }, workspace);

    assertEquals(oversized.success, true);
    assertEquals(oversized.count, 0);
    assertEquals(missing.success, true);
    assertEquals(missing.count, 0);
  });
});

Deno.test("CodeTools: findSymbol locates typed declarations and respects path and file-size limits", async () => {
  await withWorkspace(async (workspace) => {
    const platform = getPlatform();
    const hugePath = platform.path.join(workspace, "src", "huge.ts");
    await platform.fs.writeTextFile(
      hugePath,
      `export function HugeSymbol() { return 1; }\n${"Y".repeat(200)}`,
    );

    const fnResult = await findSymbol({ name: "processData", type: "function" }, workspace);
    const classResult = await findSymbol({ name: "UserService", type: "class" }, workspace);
    const constResult = await findSymbol({ name: "CONFIG", type: "const" }, workspace);
    const pathResult = await findSymbol({ name: "validateEmail", path: "src/utils.ts" }, workspace);
    const oversized = await findSymbol({ name: "HugeSymbol", maxFileBytes: 10 }, workspace);

    assertEquals(fnResult.symbols?.[0].type, "function");
    assertEquals(classResult.symbols?.[0].type, "class");
    assertEquals(constResult.symbols?.[0].type, "const");
    assertEquals(pathResult.count, 1);
    assertEquals(oversized.count, 0);
  });
});

Deno.test("CodeTools: getStructure returns a sorted tree and enforces depth and node limits", async () => {
  await withWorkspace(async (workspace) => {
    const full = await getStructure({}, workspace);
    const depthLimited = await getStructure({ maxDepth: 1 }, workspace);
    const nodeLimited = await getStructure({ maxNodes: 1 }, workspace);

    const srcNode = full.tree?.children?.find((node) => node.name === "src");
    const depthSrc = depthLimited.tree?.children?.find((node) => node.name === "src");
    const componentsNode = depthSrc?.children?.find((node) => node.name === "components");

    assertEquals(full.success, true);
    assertEquals(full.tree?.type, "directory");
    assertEquals(srcNode?.type, "directory");
    assertEquals(srcNode?.children?.[0].type, "directory");
    assertEquals(srcNode?.children?.[0].name, "components");
    assertEquals((componentsNode?.children?.length ?? 0), 0);
    assertEquals(nodeLimited.success, true);
    assertStringIncludes(nodeLimited.message ?? "", "limit");
  });
});

Deno.test("CodeTools: getStructure rejects files and paths outside the workspace", async () => {
  await withWorkspace(async (workspace) => {
    const fileResult = await getStructure({ path: "src/main.ts" }, workspace);
    const denied = await getStructure({ path: "../../etc" }, workspace);

    assertEquals(fileResult.success, false);
    assertStringIncludes(fileResult.message ?? "", "not a directory");
    assertEquals(denied.success, false);
  });
});
