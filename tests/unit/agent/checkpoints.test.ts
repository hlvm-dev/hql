/**
 * Checkpoint system tests - createCheckpointRecorder, restoreCheckpoint.
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  createCheckpointRecorder,
  loadCheckpointManifest,
  restoreCheckpoint,
} from "../../../src/hlvm/agent/checkpoints.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  getCheckpointDir,
  getSessionCheckpointsDir,
} from "../../../src/common/paths.ts";

const SESSION_ID = "test-checkpoint-session";
const REQUEST_ID = "test-request-1";

/** Create a temp HLVM_DIR and return cleanup fn. */
function setupTestEnv(): () => void {
  const tmpDir = Deno.makeTempDirSync({ prefix: "hlvm-cp-test-" });
  Deno.env.set("HLVM_DIR", tmpDir);
  return () => {
    Deno.env.delete("HLVM_DIR");
    try {
      Deno.removeSync(tmpDir, { recursive: true });
    } catch { /* ignore */ }
  };
}

Deno.test("checkpoints: recorder captures mutation and creates manifest on disk", async () => {
  const cleanup = setupTestEnv();
  try {
    const platform = getPlatform();
    const tmpFile = await Deno.makeTempFile({ suffix: ".txt" });
    await platform.fs.writeTextFile(tmpFile, "original content");

    const recorder = createCheckpointRecorder({
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
    });

    const summary = await recorder.captureFileMutation(tmpFile, {
      status: "modified",
    });
    assertExists(summary.id);
    assertEquals(summary.fileCount, 1);
    assertEquals(summary.reversible, true);

    const manifest = await loadCheckpointManifest(SESSION_ID, summary.id);
    assertExists(manifest);
    assertEquals(manifest!.files.length, 1);
    assertEquals(manifest!.files[0]!.status, "modified");

    await Deno.remove(tmpFile);
  } finally {
    cleanup();
  }
});

Deno.test("checkpoints: backup file contains original content", async () => {
  const cleanup = setupTestEnv();
  try {
    const platform = getPlatform();
    const tmpFile = await Deno.makeTempFile({ suffix: ".txt" });
    await platform.fs.writeTextFile(tmpFile, "precious data");

    const recorder = createCheckpointRecorder({
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
    });

    const summary = await recorder.captureFileMutation(tmpFile, {
      status: "modified",
    });

    // Verify backup was created
    const manifest = await loadCheckpointManifest(SESSION_ID, summary.id);
    const backupFile = manifest!.files[0]!.backupFile!;
    const checkpointDir = getCheckpointDir(SESSION_ID, summary.id);
    const backupContent = await platform.fs.readTextFile(
      platform.path.join(checkpointDir, backupFile),
    );
    assertEquals(backupContent, "precious data");

    await Deno.remove(tmpFile);
  } finally {
    cleanup();
  }
});

Deno.test("checkpoints: restore modified file returns original content", async () => {
  const cleanup = setupTestEnv();
  try {
    const platform = getPlatform();
    const tmpFile = await Deno.makeTempFile({ suffix: ".txt" });
    await platform.fs.writeTextFile(tmpFile, "original");

    const recorder = createCheckpointRecorder({
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
    });

    const summary = await recorder.captureFileMutation(tmpFile, {
      status: "modified",
    });

    // Simulate edit
    await platform.fs.writeTextFile(tmpFile, "MODIFIED!");

    const result = await restoreCheckpoint(SESSION_ID, summary.id);
    assertEquals(result.restored, true);
    assertEquals(result.restoredFileCount, 1);

    const restoredContent = await platform.fs.readTextFile(tmpFile);
    assertEquals(restoredContent, "original");

    await Deno.remove(tmpFile);
  } finally {
    cleanup();
  }
});

Deno.test("checkpoints: restore created file deletes it", async () => {
  const cleanup = setupTestEnv();
  try {
    const platform = getPlatform();

    const recorder = createCheckpointRecorder({
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
    });

    // Simulate a file that didn't exist before (status: created)
    const tmpFile = await Deno.makeTempFile({ suffix: ".txt" });
    await platform.fs.writeTextFile(tmpFile, "new file");

    // Capture as "created" — file won't have a backup because the original didn't exist
    // But the checkpoint API captures current content; for "created" it should delete on restore
    // We need to delete and re-create to simulate the flow correctly
    await Deno.remove(tmpFile);

    // Now capture mutation when file doesn't exist yet
    const summary = await recorder.captureFileMutation(tmpFile, {
      status: "created",
    });

    // Create the file (simulating write_file)
    await platform.fs.writeTextFile(tmpFile, "newly created content");

    const result = await restoreCheckpoint(SESSION_ID, summary.id);
    assertEquals(result.restored, true);
    assertEquals(result.restoredFileCount, 1);

    // File should be deleted
    assertEquals(await platform.fs.exists(tmpFile), false);
  } finally {
    cleanup();
  }
});

Deno.test("checkpoints: path deduplication — same path captured once", async () => {
  const cleanup = setupTestEnv();
  try {
    const platform = getPlatform();
    const tmpFile = await Deno.makeTempFile({ suffix: ".txt" });
    await platform.fs.writeTextFile(tmpFile, "original");

    const recorder = createCheckpointRecorder({
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
    });

    await recorder.captureFileMutation(tmpFile, { status: "modified" });
    const summary = await recorder.captureFileMutation(tmpFile, {
      status: "modified",
    });

    assertEquals(summary.fileCount, 1); // Deduplicated

    await Deno.remove(tmpFile);
  } finally {
    cleanup();
  }
});

Deno.test("checkpoints: unknown checkpoint ID returns restored=false", async () => {
  const cleanup = setupTestEnv();
  try {
    const result = await restoreCheckpoint(SESSION_ID, "nonexistent-id");
    assertEquals(result.restored, false);
    assertEquals(result.restoredFileCount, 0);
  } finally {
    cleanup();
  }
});

Deno.test("checkpoints: getSummary returns correct counts", async () => {
  const cleanup = setupTestEnv();
  try {
    const platform = getPlatform();
    const tmpFile1 = await Deno.makeTempFile({ suffix: ".txt" });
    const tmpFile2 = await Deno.makeTempFile({ suffix: ".txt" });
    await platform.fs.writeTextFile(tmpFile1, "content1");
    await platform.fs.writeTextFile(tmpFile2, "content2");

    const recorder = createCheckpointRecorder({
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
    });

    assertEquals(recorder.getSummary(), undefined); // Before any capture

    await recorder.captureFileMutation(tmpFile1, { status: "modified" });
    assertEquals(recorder.getSummary()?.fileCount, 1);

    await recorder.captureFileMutation(tmpFile2, { status: "modified" });
    assertEquals(recorder.getSummary()?.fileCount, 2);
    assertEquals(recorder.getSummary()?.requestId, REQUEST_ID);
    assertEquals(recorder.getSummary()?.reversible, true);

    await Deno.remove(tmpFile1);
    await Deno.remove(tmpFile2);
  } finally {
    cleanup();
  }
});

Deno.test("checkpoints: multiple files in one checkpoint all restored", async () => {
  const cleanup = setupTestEnv();
  try {
    const platform = getPlatform();
    const tmpFile1 = await Deno.makeTempFile({ suffix: ".txt" });
    const tmpFile2 = await Deno.makeTempFile({ suffix: ".txt" });
    await platform.fs.writeTextFile(tmpFile1, "alpha");
    await platform.fs.writeTextFile(tmpFile2, "beta");

    const recorder = createCheckpointRecorder({
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
    });

    await recorder.captureFileMutation(tmpFile1, { status: "modified" });
    const summary = await recorder.captureFileMutation(tmpFile2, {
      status: "modified",
    });

    // Simulate edits
    await platform.fs.writeTextFile(tmpFile1, "CHANGED_ALPHA");
    await platform.fs.writeTextFile(tmpFile2, "CHANGED_BETA");

    const result = await restoreCheckpoint(SESSION_ID, summary.id);
    assertEquals(result.restored, true);
    assertEquals(result.restoredFileCount, 2);
    assertEquals(await platform.fs.readTextFile(tmpFile1), "alpha");
    assertEquals(await platform.fs.readTextFile(tmpFile2), "beta");

    await Deno.remove(tmpFile1);
    await Deno.remove(tmpFile2);
  } finally {
    cleanup();
  }
});
