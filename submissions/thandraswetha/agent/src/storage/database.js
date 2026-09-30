import { readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));

async function createDatabase(databaseDir) {
  if (databaseDir) await mkdir(dirname(databaseDir), { recursive: true });
  const db = new PGlite(databaseDir);
  await db.exec("CREATE ROLE pack_manager_app NOLOGIN NOBYPASSRLS").catch((error) => {
    if (!String(error.message).includes("already exists")) throw error;
  });
  await db.exec(await readFile(schemaPath, "utf8"));

  let transactionTail = Promise.resolve();

  async function withTenant(orgId, callback) {
    const previous = transactionTail;
    let release;
    transactionTail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      await db.exec("BEGIN");
      await db.exec("SET LOCAL ROLE pack_manager_app");
      await db.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
      const result = await callback({ query: (sql, values = []) => db.query(sql, values) });
      await db.exec("COMMIT");
      return result;
    } catch (error) {
      await db.exec("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      release();
    }
  }

  return { db, withTenant, close: () => db.close() };
}

export { createDatabase };