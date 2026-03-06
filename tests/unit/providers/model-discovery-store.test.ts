import { assertEquals } from "jsr:@std/assert";
import {
  createModelDiscoveryStore,
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
  });
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
