import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL must be configured before running database migrations.");
}

const client = new Client({ connectionString });
const migrationsDirectory = resolve(process.cwd(), "migrations");

async function migrate() {
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(781204913)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS public._memora_migrations (
        id bigserial PRIMARY KEY,
        name text NOT NULL UNIQUE,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const name of files) {
      const existing = await client.query(
        "SELECT 1 FROM public._memora_migrations WHERE name = $1",
        [name],
      );
      if (existing.rowCount) {
        console.log(`Skipping already applied migration: ${name}`);
        continue;
      }

      const sql = await readFile(resolve(migrationsDirectory, name), "utf8");
      console.log(`Applying migration: ${name}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO public._memora_migrations (name) VALUES ($1)",
          [name],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    console.log("MEMORA database migrations are up to date.");
  } finally {
    await client.query("SELECT pg_advisory_unlock(781204913)").catch(() => undefined);
    await client.end();
  }
}

void migrate().catch((error: unknown) => {
  console.error("Database migration failed:", error);
  process.exitCode = 1;
});
