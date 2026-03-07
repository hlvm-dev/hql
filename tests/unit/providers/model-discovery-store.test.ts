import { assert, assertEquals } from "jsr:@std/assert";
import {
  createModelDiscoveryStore,
  getModelDiscoveryModels,
} from "../../../src/hlvm/providers/model-discovery-store.ts";
import { withTempHlvmDir } from "../helpers.ts";

Deno.test("model discovery store reads persisted snapshot before refresh", async () => {
  await withTempHlvmDir(async () => {
    const store = createModelDiscoveryStore({
      readTextFile: () =>
        Promise.resolve(JSON.stringify({
          timestamp: 123,
          remoteModels: [{ name: "qwen3:latest", displayName: "Qwen 3" }],
          cloudModels: [{
            name: "claude-sonnet-4.5",
            displayName: "Claude Sonnet 4.5",
            metadata: { provider: "anthropic" },
          }],
        })),
      readTextFileSync: () =>
        JSON.stringify({
          timestamp: 123,
          remoteModels: [{ name: "qwen3:latest", displayName: "Qwen 3" }],
          cloudModels: [{
            name: "claude-sonnet-4.5",
            displayName: "Claude Sonnet 4.5",
            metadata: { provider: "anthropic" },
          }],
        }),
      writeTextFile: () => Promise.resolve(),
      listOllamaCatalog: () => Promise.resolve([]),
      listCloudModels: () => Promise.resolve([]),
      now: () => 999,
    });

    const snapshot = await store.readSnapshot();

    assertEquals(snapshot.timestamp, 123);
    assertEquals(snapshot.remoteModels.map((model) => model.name), [
      "qwen3:latest",
    ]);
    assertEquals(snapshot.cloudModels.map((model) => model.name), [
      "claude-sonnet-4.5",
    ]);

    const syncSnapshot = store.readSnapshotSync();

    assertEquals(syncSnapshot, snapshot);
  });
});

Deno.test("model discovery store falls back to bundled seed on first run", () => {
  const store = createModelDiscoveryStore({
    readTextFile: () => Promise.reject(new Error("missing")),
    readTextFileSync: () => {
      throw new Error("missing");
    },
    writeTextFile: () => Promise.resolve(),
    writeTextFileSync: () => {},
    listOllamaCatalog: () => Promise.reject(new Error("offline")),
    listCloudModels: () => Promise.reject(new Error("offline")),
  });

  const snapshot = store.readSnapshotSync();

  assert(snapshot.remoteModels.length > 0);
  assert(snapshot.cloudModels.length > 0);
  assert(
    snapshot.remoteModels.some((model) => model.name === "llama3.1:latest"),
  );
  assert(snapshot.cloudModels.some((model) => model.name === "gpt-5.4"));
});

Deno.test("model discovery store preserves cached cloud models when refresh fails", async () => {
  await withTempHlvmDir(async () => {
    let writtenSnapshot = "";
    const store = createModelDiscoveryStore({
      readTextFile: () =>
        Promise.resolve(JSON.stringify({
          timestamp: 100,
          remoteModels: [{ name: "old-remote", displayName: "Old Remote" }],
          cloudModels: [{
            name: "claude-sonnet-4.5",
            displayName: "Claude Sonnet 4.5",
            metadata: { provider: "anthropic" },
          }],
        })),
      writeTextFile: (_path, content) => {
        writtenSnapshot = content;
        return Promise.resolve();
      },
      listOllamaCatalog: () =>
        Promise.resolve([{ name: "new-remote", displayName: "New Remote" }]),
      listCloudModels: () => Promise.reject(new Error("cloud unavailable")),
      now: () => 200,
    });

    const result = await store.refreshSnapshot();

    assertEquals(result.failed, true);
    assertEquals(result.snapshot.timestamp, 200);
    assertEquals(result.snapshot.remoteModels.map((model) => model.name), [
      "new-remote",
    ]);
    assertEquals(result.snapshot.cloudModels.map((model) => model.name), [
      "claude-sonnet-4.5",
    ]);
    assertEquals(JSON.parse(writtenSnapshot), {
      timestamp: 200,
      remoteModels: [{ name: "new-remote", displayName: "New Remote" }],
      cloudModels: [{
        name: "claude-sonnet-4.5",
        displayName: "Claude Sonnet 4.5",
        metadata: { provider: "anthropic" },
      }],
    });
  });
});

Deno.test("model discovery store clears stale models after a successful empty refresh", async () => {
  await withTempHlvmDir(async () => {
    let writtenSnapshot = "";
    const store = createModelDiscoveryStore({
      readTextFile: () =>
        Promise.resolve(JSON.stringify({
          timestamp: 100,
          remoteModels: [{ name: "old-remote", displayName: "Old Remote" }],
          cloudModels: [{
            name: "claude-sonnet-4.5",
            displayName: "Claude Sonnet 4.5",
            metadata: { provider: "anthropic" },
          }],
        })),
      readTextFileSync: () =>
        JSON.stringify({
          timestamp: 100,
          remoteModels: [{ name: "old-remote", displayName: "Old Remote" }],
          cloudModels: [{
            name: "claude-sonnet-4.5",
            displayName: "Claude Sonnet 4.5",
            metadata: { provider: "anthropic" },
          }],
        }),
      writeTextFile: (_path, content) => {
        writtenSnapshot = content;
        return Promise.resolve();
      },
      listOllamaCatalog: () =>
        Promise.resolve({ models: [], authoritativeEmpty: true }),
      listCloudModels: () =>
        Promise.resolve({ models: [], authoritativeEmpty: true }),
      now: () => 200,
    });

    const result = await store.refreshSnapshot();

    assertEquals(result.failed, false);
    assertEquals(result.snapshot.timestamp, 200);
    assertEquals(result.snapshot.remoteModels, []);
    assertEquals(result.snapshot.cloudModels, []);
    assertEquals(JSON.parse(writtenSnapshot), {
      timestamp: 200,
      remoteModels: [],
      cloudModels: [],
    });
  });
});

Deno.test("model discovery store preserves cached models on ambiguous empty refreshes", async () => {
  await withTempHlvmDir(async () => {
    let writtenSnapshot = "";
    const store = createModelDiscoveryStore({
      readTextFile: () =>
        Promise.resolve(JSON.stringify({
          timestamp: 100,
          remoteModels: [{ name: "old-remote", displayName: "Old Remote" }],
          cloudModels: [{
            name: "claude-sonnet-4.5",
            displayName: "Claude Sonnet 4.5",
            metadata: { provider: "anthropic" },
          }],
        })),
      readTextFileSync: () =>
        JSON.stringify({
          timestamp: 100,
          remoteModels: [{ name: "old-remote", displayName: "Old Remote" }],
          cloudModels: [{
            name: "claude-sonnet-4.5",
            displayName: "Claude Sonnet 4.5",
            metadata: { provider: "anthropic" },
          }],
        }),
      writeTextFile: (_path, content) => {
        writtenSnapshot = content;
        return Promise.resolve();
      },
      listOllamaCatalog: () => Promise.resolve([]),
      listCloudModels: () => Promise.resolve([]),
      now: () => 200,
    });

    const result = await store.refreshSnapshot();

    assertEquals(result.failed, true);
    assertEquals(result.snapshot.timestamp, 100);
    assertEquals(result.snapshot.remoteModels.map((model) => model.name), [
      "old-remote",
    ]);
    assertEquals(result.snapshot.cloudModels.map((model) => model.name), [
      "claude-sonnet-4.5",
    ]);
    assertEquals(writtenSnapshot, "");
  });
});

Deno.test("getModelDiscoveryModels dedupes local and cached models by canonical id", () => {
  const models = getModelDiscoveryModels({
    timestamp: 100,
    remoteModels: [{
      name: "qwen3:latest",
      displayName: "Qwen 3 Remote",
      metadata: { provider: "ollama" },
    }],
    cloudModels: [{
      name: "claude-sonnet-4.5",
      displayName: "Claude Sonnet 4.5",
      metadata: { provider: "anthropic" },
    }],
  }, {
    localModels: [{
      name: "qwen3:latest",
      displayName: "Qwen 3 Local",
      size: 4096,
      metadata: { provider: "ollama" },
    }],
  });

  assertEquals(models.map((model) => model.name), [
    "qwen3:latest",
    "claude-sonnet-4.5",
  ]);
  assertEquals(models[0]?.size, 4096);
});
