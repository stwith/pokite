import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import fs from "node:fs";

// Keep only a small indexed fingerprint forever: dropping deduplication IDs
// would allow an old browser retry to execute the same command again.
export const fingerprint = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class RetiredReceipts {
  constructor(file) {
    this.file = file;
  }
  database() {
    const db = new DatabaseSync(this.file);
    fs.chmodSync(this.file, 0o600);
    db.exec(
      "CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, hash TEXT NOT NULL)",
    );
    return db;
  }
  get(id) {
    const db = this.database();
    try {
      return db
        .prepare("SELECT hash FROM receipts WHERE id=?")
        .get(fingerprint(id))?.hash;
    } finally {
      db.close();
    }
  }
  put(rows) {
    if (!rows.length) return;
    const db = this.database();
    try {
      db.exec("BEGIN");
      const insert = db.prepare(
        "INSERT OR IGNORE INTO receipts(id,hash) VALUES (?,?)",
      );
      for (const [id, hash] of rows) insert.run(fingerprint(id), hash);
      db.exec("COMMIT");
    } finally {
      db.close();
    }
  }
}
