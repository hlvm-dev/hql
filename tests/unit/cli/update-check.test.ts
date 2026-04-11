/**
 * Update-check tests — unit + e2e scenarios with realistic fake data.
 */
import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { http } from "../../../src/common/http-client.ts";
import {
  checkForUpdate,
  fetchLatestRelease,
  getUpgradeCommand,
  isNewer,
} from "../../../src/hlvm/cli/utils/update-check.ts";
import { VERSION } from "../../../src/common/version.ts";
import { withTempHlvmDir } from "../helpers.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { getHlvmDir } from "../../../src/common/paths.ts";

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

Deno.test("isNewer returns true when latest > current", () => {
  assertEquals(isNewer("0.2.0", "0.1.0"), true);
  assertEquals(isNewer("1.0.0", "0.9.9"), true);
  assertEquals(isNewer("0.1.1", "0.1.0"), true);
});

Deno.test("isNewer returns false when latest <= current", () => {
  assertEquals(isNewer("0.1.0", "0.1.0"), false);
  assertEquals(isNewer("0.0.9", "0.1.0"), false);
  assertEquals(isNewer("0.1.0", "0.2.0"), false);
});

Deno.test("getUpgradeCommand returns platform-appropriate command", () => {
  const cmd = getUpgradeCommand();
  if (Deno.build.os === "windows") {
    assertEquals(cmd, "irm hlvm.dev/install.ps1 | iex");
  } else {
    assertEquals(cmd, "curl -fsSL hlvm.dev/install.sh | sh");
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fake GitHub release response matching real API shape. */
function fakeRelease(tag: string, url?: string) {
  return {
    tag_name: tag,
    html_url: url ?? `https://github.com/hlvm-dev/hql/releases/tag/${tag}`,
    name: `HLVM ${tag.replace(/^v/, "")}`,
    published_at: "2026-04-10T00:00:00Z",
    assets: [
      { name: "hlvm-mac-arm", size: 85_000_000 },
      { name: "hlvm-linux", size: 90_000_000 },
      { name: "checksums.sha256", size: 256 },
    ],
  };
}

/** Temporarily replace http.get with a fake. Restores on cleanup. */
function withFakeHttpGet<T>(
  fake: (url: string) => T,
  fn: () => Promise<void>,
): Promise<void> {
  const original = http.get.bind(http);
  http.get = (async (url: string) => fake(url)) as typeof http.get;
  return fn().finally(() => {
    http.get = original;
  });
}

// ---------------------------------------------------------------------------
// E2E Scenarios
// ---------------------------------------------------------------------------

Deno.test("e2e: fetchLatestRelease parses realistic GitHub response", async () => {
  await withFakeHttpGet(
    () => fakeRelease("v0.3.0"),
    async () => {
      const result = await fetchLatestRelease();
      assertEquals(result?.version, "0.3.0");
      assertEquals(
        result?.releaseUrl,
        "https://github.com/hlvm-dev/hql/releases/tag/v0.3.0",
      );
    },
  );
});

Deno.test("e2e: fetchLatestRelease returns null for empty tag", async () => {
  await withFakeHttpGet(
    () => ({ tag_name: "", html_url: "" }),
    async () => {
      assertEquals(await fetchLatestRelease(), null);
    },
  );
});

Deno.test("e2e: checkForUpdate returns UpdateInfo when newer version exists", async () => {
  await withTempHlvmDir(async () => {
    await withFakeHttpGet(
      () => fakeRelease("v99.0.0"),
      async () => {
        const info = await checkForUpdate();
        assertNotEquals(info, null);
        assertEquals(info!.current, VERSION);
        assertEquals(info!.latest, "99.0.0");
        assertEquals(info!.upgradeCommand, getUpgradeCommand());
        assertEquals(
          info!.releaseUrl,
          "https://github.com/hlvm-dev/hql/releases/tag/v99.0.0",
        );
      },
    );
  });
});

Deno.test("e2e: checkForUpdate returns null when already up-to-date", async () => {
  await withTempHlvmDir(async () => {
    await withFakeHttpGet(
      () => fakeRelease(`v${VERSION}`),
      async () => {
        assertEquals(await checkForUpdate(), null);
      },
    );
  });
});

Deno.test("e2e: checkForUpdate returns null when on newer version", async () => {
  await withTempHlvmDir(async () => {
    await withFakeHttpGet(
      () => fakeRelease("v0.0.1"),
      async () => {
        assertEquals(await checkForUpdate(), null);
      },
    );
  });
});

Deno.test("e2e: checkForUpdate writes cache and second call reads from cache", async () => {
  await withTempHlvmDir(async () => {
    let fetchCount = 0;
    await withFakeHttpGet(
      () => {
        fetchCount++;
        return fakeRelease("v99.0.0");
      },
      async () => {
        // First call — should fetch
        const first = await checkForUpdate();
        assertEquals(fetchCount, 1);
        assertNotEquals(first, null);

        // Second call — should hit cache, no new fetch
        const second = await checkForUpdate();
        assertEquals(fetchCount, 1); // Still 1 — cache hit
        assertNotEquals(second, null);
        assertEquals(second!.latest, "99.0.0");
      },
    );
  });
});

Deno.test("e2e: cache file written to disk with correct shape", async () => {
  await withTempHlvmDir(async () => {
    await withFakeHttpGet(
      () => fakeRelease("v2.0.0"),
      async () => {
        await checkForUpdate();

        const platform = getPlatform();
        const cachePath = platform.path.join(
          getHlvmDir(),
          "update-check.json",
        );
        const raw = await platform.fs.readTextFile(cachePath);
        const cache = JSON.parse(raw);

        assertEquals(cache.latest, "2.0.0");
        assertEquals(cache.current, VERSION);
        assertEquals(typeof cache.checked_at, "number");
        assertEquals(
          cache.release_url,
          "https://github.com/hlvm-dev/hql/releases/tag/v2.0.0",
        );
      },
    );
  });
});

Deno.test("e2e: checkForUpdate returns null when network fails", async () => {
  await withTempHlvmDir(async () => {
    await withFakeHttpGet(
      () => {
        throw new Error("Network unreachable");
      },
      async () => {
        // Should not throw, just return null
        assertEquals(await checkForUpdate(), null);
      },
    );
  });
});

Deno.test("e2e: checkForUpdate respects HLVM_NO_UPDATE_CHECK=1", async () => {
  await withTempHlvmDir(async () => {
    const originalGet = Deno.env.get("HLVM_NO_UPDATE_CHECK");
    Deno.env.set("HLVM_NO_UPDATE_CHECK", "1");
    try {
      let fetched = false;
      await withFakeHttpGet(
        () => {
          fetched = true;
          return fakeRelease("v99.0.0");
        },
        async () => {
          assertEquals(await checkForUpdate(), null);
          assertEquals(fetched, false); // Should not even try to fetch
        },
      );
    } finally {
      if (originalGet !== undefined) {
        Deno.env.set("HLVM_NO_UPDATE_CHECK", originalGet);
      } else {
        Deno.env.delete("HLVM_NO_UPDATE_CHECK");
      }
    }
  });
});

Deno.test("e2e: stale cache triggers fresh fetch", async () => {
  await withTempHlvmDir(async () => {
    // Write an expired cache (25 hours ago)
    const platform = getPlatform();
    const cachePath = platform.path.join(getHlvmDir(), "update-check.json");
    const staleCache = {
      latest: "1.0.0",
      current: VERSION,
      checked_at: Date.now() - 25 * 60 * 60 * 1000, // 25h ago
      release_url: "https://github.com/hlvm-dev/hql/releases/tag/v1.0.0",
    };
    await platform.fs.writeTextFile(
      cachePath,
      JSON.stringify(staleCache),
    );

    let fetchCount = 0;
    await withFakeHttpGet(
      () => {
        fetchCount++;
        return fakeRelease("v99.0.0"); // newer version from fresh fetch
      },
      async () => {
        const info = await checkForUpdate();
        assertEquals(fetchCount, 1); // Did fetch — cache was stale
        assertNotEquals(info, null);
        assertEquals(info!.latest, "99.0.0"); // Got fresh data, not cached "1.0.0"
      },
    );
  });
});

Deno.test("e2e: version upgrade invalidates cache", async () => {
  await withTempHlvmDir(async () => {
    // Cache was written by a previous version
    const platform = getPlatform();
    const cachePath = platform.path.join(getHlvmDir(), "update-check.json");
    const oldVersionCache = {
      latest: VERSION, // same as current — was up-to-date for old version
      current: "0.0.1", // but written by older binary
      checked_at: Date.now(), // recent
      release_url: "https://github.com/hlvm-dev/hql/releases/tag/v0.1.0",
    };
    await platform.fs.writeTextFile(
      cachePath,
      JSON.stringify(oldVersionCache),
    );

    let fetchCount = 0;
    await withFakeHttpGet(
      () => {
        fetchCount++;
        return fakeRelease(`v${VERSION}`); // same as current
      },
      async () => {
        const info = await checkForUpdate();
        assertEquals(fetchCount, 1); // Did fetch — cache.current !== VERSION
        assertEquals(info, null); // Up to date
      },
    );
  });
});
