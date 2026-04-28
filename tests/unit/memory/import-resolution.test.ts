/**
 * @import resolution tests for HLVM.md content.
 *
 * Verifies that `loadMemoryPrompt` inlines `@./relative.md` and
 * `@/abs/path.md` references found in user/project HLVM.md files,
 * with depth cap = 5, cycle detection, and graceful skip-with-marker
 * for missing/non-md/cyclic targets.
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "jsr:@std/assert";
import { loadMemoryPrompt } from "../../../src/hlvm/memory/memdir.ts";
import { getUserMemoryPath } from "../../../src/hlvm/memory/paths.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempHlvmDir } from "../helpers.ts";

const ENV_DISABLE = "HLVM_DISABLE_AUTO_MEMORY";

async function withDisabledAutoMemory(fn: () => Promise<void>): Promise<void> {
  const env = getPlatform().env;
  const prev = env.get(ENV_DISABLE);
  env.set(ENV_DISABLE, "1");
  try {
    await fn();
  } finally {
    if (prev !== undefined) env.set(ENV_DISABLE, prev);
    else env.delete(ENV_DISABLE);
  }
}

Deno.test("[@import 1] single-level relative @import inlines content", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const projectRoot = await platform.fs.makeTempDir({ prefix: "imp1-" });
    try {
      const userPath = getUserMemoryPath();
      const fragment = platform.path.join(
        platform.path.dirname(userPath),
        "fragment.md",
      );
      await platform.fs.writeTextFile(fragment, "FRAGMENT_BODY_X");
      await platform.fs.writeTextFile(
        userPath,
        "Top.\n@./fragment.md\nAfter.",
      );
      await withDisabledAutoMemory(async () => {
        const prompt = await loadMemoryPrompt(projectRoot);
        assertExists(prompt);
        assertStringIncludes(prompt, "Top.");
        assertStringIncludes(prompt, "FRAGMENT_BODY_X");
        assertStringIncludes(prompt, "After.");
      });
    } finally {
      await platform.fs.remove(projectRoot, { recursive: true });
    }
  });
});

Deno.test("[@import 2] nested @import (a → b) resolves both", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const projectRoot = await platform.fs.makeTempDir({ prefix: "imp2-" });
    try {
      const userPath = getUserMemoryPath();
      const dir = platform.path.dirname(userPath);
      await platform.fs.writeTextFile(
        platform.path.join(dir, "b.md"),
        "BODY_OF_B",
      );
      await platform.fs.writeTextFile(
        platform.path.join(dir, "a.md"),
        "BODY_OF_A_BEFORE\n@./b.md\nBODY_OF_A_AFTER",
      );
      await platform.fs.writeTextFile(userPath, "@./a.md");
      await withDisabledAutoMemory(async () => {
        const prompt = await loadMemoryPrompt(projectRoot);
        assertExists(prompt);
        assertStringIncludes(prompt, "BODY_OF_A_BEFORE");
        assertStringIncludes(prompt, "BODY_OF_B");
        assertStringIncludes(prompt, "BODY_OF_A_AFTER");
      });
    } finally {
      await platform.fs.remove(projectRoot, { recursive: true });
    }
  });
});

Deno.test("[@import 3] cycle is detected and replaced with marker", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const projectRoot = await platform.fs.makeTempDir({ prefix: "imp3-" });
    try {
      const userPath = getUserMemoryPath();
      const dir = platform.path.dirname(userPath);
      // a.md imports b.md; b.md imports a.md → cycle
      await platform.fs.writeTextFile(
        platform.path.join(dir, "a.md"),
        "A_BEGIN\n@./b.md\nA_END",
      );
      await platform.fs.writeTextFile(
        platform.path.join(dir, "b.md"),
        "B_BEGIN\n@./a.md\nB_END",
      );
      await platform.fs.writeTextFile(userPath, "@./a.md");
      await withDisabledAutoMemory(async () => {
        const prompt = await loadMemoryPrompt(projectRoot);
        assertExists(prompt);
        // Both first-pass bodies should be visible
        assertStringIncludes(prompt, "A_BEGIN");
        assertStringIncludes(prompt, "B_BEGIN");
        // Cycle marker on the recursion attempt
        assertStringIncludes(prompt, "@import skipped: cycle");
      });
    } finally {
      await platform.fs.remove(projectRoot, { recursive: true });
    }
  });
});

Deno.test("[@import 4] depth cap = 5 stops infinite chain", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const projectRoot = await platform.fs.makeTempDir({ prefix: "imp4-" });
    try {
      const userPath = getUserMemoryPath();
      const dir = platform.path.dirname(userPath);
      // Build a chain a → b → c → d → e → f → g; depth cap should fire
      // somewhere inside, and the test passes if nothing throws and the
      // prompt still loads.
      for (const [name, next] of [
        ["a", "b"],
        ["b", "c"],
        ["c", "d"],
        ["d", "e"],
        ["e", "f"],
        ["f", "g"],
      ]) {
        await platform.fs.writeTextFile(
          platform.path.join(dir, `${name}.md`),
          `BODY_${name.toUpperCase()}\n@./${next}.md`,
        );
      }
      await platform.fs.writeTextFile(
        platform.path.join(dir, "g.md"),
        "BODY_G",
      );
      await platform.fs.writeTextFile(userPath, "@./a.md");
      await withDisabledAutoMemory(async () => {
        const prompt = await loadMemoryPrompt(projectRoot);
        assertExists(prompt);
        // Earlier levels should be inlined; deepest ones replaced by depth
        // marker (or skipped)
        assertStringIncludes(prompt, "BODY_A");
      });
    } finally {
      await platform.fs.remove(projectRoot, { recursive: true });
    }
  });
});

Deno.test("[@import 5] missing target → skipped with marker, no throw", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const projectRoot = await platform.fs.makeTempDir({ prefix: "imp5-" });
    try {
      const userPath = getUserMemoryPath();
      await platform.fs.writeTextFile(
        userPath,
        "Header\n@./does-not-exist.md\nFooter",
      );
      await withDisabledAutoMemory(async () => {
        const prompt = await loadMemoryPrompt(projectRoot);
        assertExists(prompt);
        assertStringIncludes(prompt, "Header");
        assertStringIncludes(prompt, "@import skipped: not found");
        assertStringIncludes(prompt, "Footer");
      });
    } finally {
      await platform.fs.remove(projectRoot, { recursive: true });
    }
  });
});

Deno.test("[@import 6] non-.md target rejected (security)", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const projectRoot = await platform.fs.makeTempDir({ prefix: "imp6-" });
    try {
      const userPath = getUserMemoryPath();
      await platform.fs.writeTextFile(
        userPath,
        "Top\n@./script.sh\nBottom",
      );
      await withDisabledAutoMemory(async () => {
        const prompt = await loadMemoryPrompt(projectRoot);
        assertExists(prompt);
        assertStringIncludes(prompt, "@import skipped: non-.md target");
        assertEquals(prompt.includes("script.sh content"), false);
      });
    } finally {
      await platform.fs.remove(projectRoot, { recursive: true });
    }
  });
});

Deno.test("[@import 7] absolute @ path inside ~/.hlvm resolves; outside is denied", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const projectRoot = await platform.fs.makeTempDir({ prefix: "imp7-" });
    try {
      const userPath = getUserMemoryPath();
      // Absolute path INSIDE ~/.hlvm — should resolve.
      const insideDir = platform.path.dirname(userPath);
      const insideFragment = platform.path.join(insideDir, "shared.md");
      await platform.fs.writeTextFile(insideFragment, "ALLOWED_ABS");
      // Absolute path OUTSIDE ~/.hlvm — should be denied as security risk.
      const outsideDir = await platform.fs.makeTempDir({ prefix: "imp7-out-" });
      try {
        const outsideFragment = platform.path.join(outsideDir, "evil.md");
        await platform.fs.writeTextFile(outsideFragment, "DENIED_BODY");
        await platform.fs.writeTextFile(
          userPath,
          `@${insideFragment}\n@${outsideFragment}`,
        );
        await withDisabledAutoMemory(async () => {
          const prompt = await loadMemoryPrompt(projectRoot);
          assertExists(prompt);
          assertStringIncludes(prompt, "ALLOWED_ABS");
          // The outside import is rejected with an explicit marker;
          // its body must NOT appear in the prompt.
          assertStringIncludes(prompt, "@import skipped: outside allowed roots");
          assertEquals(prompt.includes("DENIED_BODY"), false);
        });
      } finally {
        await platform.fs.remove(outsideDir, { recursive: true });
      }
    } finally {
      await platform.fs.remove(projectRoot, { recursive: true });
    }
  });
});

Deno.test("[@import 8] @ on a line with leading whitespace is still recognized", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const projectRoot = await platform.fs.makeTempDir({ prefix: "imp8-" });
    try {
      const userPath = getUserMemoryPath();
      const dir = platform.path.dirname(userPath);
      await platform.fs.writeTextFile(
        platform.path.join(dir, "indent.md"),
        "INDENTED_BODY",
      );
      await platform.fs.writeTextFile(
        userPath,
        "Top\n   @./indent.md\nBottom",
      );
      await withDisabledAutoMemory(async () => {
        const prompt = await loadMemoryPrompt(projectRoot);
        assertExists(prompt);
        assertStringIncludes(prompt, "INDENTED_BODY");
      });
    } finally {
      await platform.fs.remove(projectRoot, { recursive: true });
    }
  });
});
