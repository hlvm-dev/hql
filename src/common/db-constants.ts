export const SQLITE_BUSY_TIMEOUT_MS = 5000;
export const SQLITE_PRAGMA_WAL = "PRAGMA journal_mode = WAL";
export const SQLITE_PRAGMA_FOREIGN_KEYS = "PRAGMA foreign_keys = ON";
export const SQLITE_PRAGMA_BUSY_TIMEOUT = `PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`;
