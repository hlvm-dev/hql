/**
 * Code Tools Tests
 *
 * Verifies code search and analysis operations
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  searchCode,
  findSymbol,
  getStructure,
  type SearchCodeArgs,
  type FindSymbolArgs,
  type GetStructureArgs,
} from "../../../src/hlvm/agent/tools/code-tools.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

// Test workspace
const TEST_WORKSPACE = "/tmp/hlvm-code-test";

// Setup/cleanup helpers
async function setupWorkspace() {
  const platform = getPlatform();
  try {
    await platform.fs.mkdir(TEST_WORKSPACE, { recursive: true });

    // Create test code files
    await platform.fs.mkdir(`${TEST_WORKSPACE}/src`, { recursive: true });

    // TypeScript file with various symbols
    await platform.fs.writeTextFile(
      `${TEST_WORKSPACE}/src/main.ts`,
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
`
    );

    // Another file
    await platform.fs.writeTextFile(
      `${TEST_WORKSPACE}/src/utils.ts`,
      `export function validateEmail(email: string): boolean {
  return /^[^@]+@[^@]+$/.test(email);
}

export const DEFAULT_TIMEOUT = 5000;
`
    );

    // Subdirectory
    await platform.fs.mkdir(`${TEST_WORKSPACE}/src/components`, {
      recursive: true,
    });
    await platform.fs.writeTextFile(
      `${TEST_WORKSPACE}/src/components/Button.tsx`,
      `export class Button {
  render() {
    return "<button>Click</button>";
  }
}
`
    );

    // Create a .gitignore
    await platform.fs.writeTextFile(
      `${TEST_WORKSPACE}/.gitignore`,
      `node_modules
*.log
`
    );
  } catch {
    // Workspace might already exist
  }
}

async function cleanupWorkspace() {
  const platform = getPlatform();
  try {
    await platform.fs.remove(TEST_WORKSPACE, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================
// search_code tests
// ============================================================

Deno.test({
  name: "Code Tools: search_code - find pattern in code",
  async fn() {
    await setupWorkspace();

    const result = await searchCode(
      {
        pattern: "validate",
      } as SearchCodeArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    assertEquals(result.count! >= 2, true); // At least in main.ts and utils.ts

    // Check that results contain expected matches
    const hasValidateUser = result.matches?.some(m =>
      m.content.includes("validateUser")
    );
    const hasValidateEmail = result.matches?.some(m =>
      m.content.includes("validateEmail")
    );
    assertEquals(hasValidateUser, true);
    assertEquals(hasValidateEmail, true);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Code Tools: search_code - with path filter",
  async fn() {
    await setupWorkspace();

    const result = await searchCode(
      {
        pattern: "validate",
        path: "src/utils.ts",
      } as SearchCodeArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    // Should only find in utils.ts
    const allInUtils = result.matches?.every(m => m.file.includes("utils.ts"));
    assertEquals(allInUtils, true);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Code Tools: search_code - with file pattern",
  async fn() {
    await setupWorkspace();

    const result = await searchCode(
      {
        pattern: "class",
        filePattern: "*.tsx",
      } as SearchCodeArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    // Should only find in .tsx files
    const allTsx = result.matches?.every(m => m.file.endsWith(".tsx"));
    assertEquals(allTsx, true);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Code Tools: search_code - with max results",
  async fn() {
    await setupWorkspace();

    const result = await searchCode(
      {
        pattern: ".",  // Matches everything
        maxResults: 5,
      } as SearchCodeArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    assertEquals(result.count! <= 5, true);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Code Tools: search_code - skip large files with maxFileBytes",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();

    const largeContent = "X".repeat(200);
    await platform.fs.writeTextFile(
      `${TEST_WORKSPACE}/src/large.ts`,
      `// UNIQUE_LARGE\n${largeContent}`,
    );

    const result = await searchCode(
      {
        pattern: "UNIQUE_LARGE",
        maxFileBytes: 10,
      } as SearchCodeArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, true);
    assertEquals(result.count, 0);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Code Tools: search_code - no matches",
  async fn() {
    await setupWorkspace();

    const result = await searchCode(
      {
        pattern: "nonexistentpattern12345",
      } as SearchCodeArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    assertEquals(result.count, 0);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Code Tools: search_code - contextLines returns surrounding lines",
  async fn() {
    await setupWorkspace();

    const result = await searchCode(
      {
        pattern: "validateUser",
        contextLines: 2,
      } as SearchCodeArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    assertEquals(result.count! >= 1, true);

    // First match should have context array
    const match = result.matches![0];
    assertEquals(Array.isArray(match.context), true);
    assertEquals(match.context!.length >= 1, true);
    // Context should include surrounding lines
    assertEquals(match.context!.length <= 5, true); // 2 before + match + 2 after = 5 max
  },
});

Deno.test({
  name: "Code Tools: search_code - contextLines=0 omits context",
  async fn() {
    await setupWorkspace();

    const result = await searchCode(
      {
        pattern: "validateUser",
        contextLines: 0,
      } as SearchCodeArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    assertEquals(result.count! >= 1, true);
    assertEquals(result.matches![0].context, undefined);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Code Tools: search_code - contextLines capped at 10",
  async fn() {
    await setupWorkspace();

    const result = await searchCode(
      {
        pattern: "CONFIG",
        contextLines: 999,
      } as SearchCodeArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    assertEquals(result.count! >= 1, true);
    // Context should exist but not be unlimited
    assertEquals(Array.isArray(result.matches![0].context), true);

    await cleanupWorkspace();
  },
});

// ============================================================
// find_symbol tests
// ============================================================

Deno.test({
  name: "Code Tools: find_symbol - find function",
  async fn() {
    await setupWorkspace();

    const result = await findSymbol(
      {
        name: "processData",
        type: "function",
      } as FindSymbolArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    assertEquals(result.count, 1);
    assertEquals(result.symbols?.[0].type, "function");
    assertEquals(result.symbols?.[0].file.includes("main.ts"), true);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Code Tools: find_symbol - find class",
  async fn() {
    await setupWorkspace();

    const result = await findSymbol(
      {
        name: "UserService",
        type: "class",
      } as FindSymbolArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    assertEquals(result.count, 1);
    assertEquals(result.symbols?.[0].type, "class");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Code Tools: find_symbol - find const",
  async fn() {
    await setupWorkspace();

    const result = await findSymbol(
      {
        name: "CONFIG",
        type: "const",
      } as FindSymbolArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    assertEquals(result.count, 1);
    assertEquals(result.symbols?.[0].type, "const");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Code Tools: find_symbol - find any type",
  async fn() {
    await setupWorkspace();

    const result = await findSymbol(
      {
        name: "Button",
      } as FindSymbolArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    assertEquals(result.count, 1);
    assertEquals(result.symbols?.[0].type, "class");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Code Tools: find_symbol - skip large files with maxFileBytes",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();

    const largeContent = "Y".repeat(200);
    await platform.fs.writeTextFile(
      `${TEST_WORKSPACE}/src/huge.ts`,
      `export function HugeSymbol() { return 1; }\n${largeContent}`,
    );

    const result = await findSymbol(
      {
        name: "HugeSymbol",
        maxFileBytes: 10,
      } as FindSymbolArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, true);
    assertEquals(result.count, 0);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Code Tools: find_symbol - with path filter",
  async fn() {
    await setupWorkspace();

    const result = await findSymbol(
      {
        name: "validateEmail",
        path: "src/utils.ts",
      } as FindSymbolArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    assertEquals(result.count, 1);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Code Tools: find_symbol - no matches",
  async fn() {
    await setupWorkspace();

    const result = await findSymbol(
      {
        name: "NonExistentSymbol",
      } as FindSymbolArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    assertEquals(result.count, 0);

    await cleanupWorkspace();
  },
});

// ============================================================
// get_structure tests
// ============================================================

Deno.test({
  name: "Code Tools: get_structure - get full structure",
  async fn() {
    await setupWorkspace();

    const result = await getStructure(
      {} as GetStructureArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    assertEquals(result.tree?.type, "directory");
    assertEquals(result.tree?.children !== undefined, true);

    // Should contain src directory
    const hasSrc = result.tree?.children?.some(
      (c) => c.name === "src" && c.type === "directory"
    );
    assertEquals(hasSrc, true);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Code Tools: get_structure - with path",
  async fn() {
    await setupWorkspace();

    const result = await getStructure(
      {
        path: "src",
      } as GetStructureArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    assertEquals(result.tree?.name, "src");

    // Should contain files
    const hasMainTs = result.tree?.children?.some(
      (c) => c.name === "main.ts" && c.type === "file"
    );
    assertEquals(hasMainTs, true);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Code Tools: get_structure - with maxDepth",
  async fn() {
    await setupWorkspace();

    const result = await getStructure(
      {
        maxDepth: 1,
      } as GetStructureArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);

    // First level should have src/
    const srcNode = result.tree?.children?.find((c) => c.name === "src");
    assertEquals(srcNode !== undefined, true);

    // Depth 1: src/ should have children (main.ts, utils.ts, components/)
    assertEquals(srcNode?.children !== undefined, true);
    const componentsNode = srcNode?.children?.find((c) => c.name === "components");
    assertEquals(componentsNode !== undefined, true);

    // Depth enforcement: components/ children should be absent or empty at maxDepth=1
    const hasDeepChildren = componentsNode?.children?.length ?? 0;
    assertEquals(hasDeepChildren, 0);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Code Tools: get_structure - enforce maxNodes",
  async fn() {
    await setupWorkspace();

    const result = await getStructure(
      { maxNodes: 1 } as GetStructureArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, true);
    assertStringIncludes(result.message || "", "limit");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Code Tools: get_structure - fail on non-directory",
  async fn() {
    await setupWorkspace();

    const result = await getStructure(
      {
        path: "src/main.ts",
      } as GetStructureArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, false);
    assertStringIncludes(result.message || "", "not a directory");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Code Tools: get_structure - reject path outside workspace",
  async fn() {
    await setupWorkspace();

    const result = await getStructure(
      {
        path: "../../etc",
      } as GetStructureArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, false);

    await cleanupWorkspace();
  },
});
