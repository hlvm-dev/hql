import { Database } from "@db/sqlite";
import { initSchema } from "../../../src/hlvm/store/schema.ts";
import { _setDbForTesting } from "../../../src/hlvm/store/db.ts";

export function setupStoreTestDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  initSchema(db);
  _setDbForTesting(db);
  return db;
}
