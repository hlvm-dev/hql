import { Database } from "@db/sqlite";
import { initSchema } from "../../../src/hlvm/store/schema.ts";
import {
  _clearDbForTesting,
  _setDbForTesting,
} from "../../../src/hlvm/store/db.ts";

const STORE_DB_LOCK = new Int32Array(new SharedArrayBuffer(4));

function acquireStoreTestDbLock(): void {
  while (Atomics.compareExchange(STORE_DB_LOCK, 0, 0, 1) !== 0) {
    Atomics.wait(STORE_DB_LOCK, 0, 1, 10);
  }
}

function releaseStoreTestDbLock(): void {
  Atomics.store(STORE_DB_LOCK, 0, 0);
  Atomics.notify(STORE_DB_LOCK, 0, 1);
}

export function setupStoreTestDb(): Database {
  acquireStoreTestDbLock();
  let db: Database | null = null;
  let close: (() => void) | undefined;
  let closed = false;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseStoreTestDbLock();
  };
  try {
    db = new Database(":memory:");
    close = db.close.bind(db);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    initSchema(db);
    _setDbForTesting(db);
    Object.defineProperty(db, "close", {
      value: () => {
        if (closed) return;
        closed = true;
        _clearDbForTesting(db ?? undefined);
        try {
          close?.();
        } finally {
          release();
        }
      },
    });
    return db;
  } catch (error) {
    _clearDbForTesting(db ?? undefined);
    if (db && !closed) {
      try {
        close?.();
      } catch {
        // best-effort cleanup before releasing the global test lock
      }
    }
    release();
    throw error;
  }
}
