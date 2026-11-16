import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL && typeof process.loadEnvFile === "function") {
  const currentDir =
    typeof __dirname !== "undefined"
      ? __dirname
      : dirname(fileURLToPath(import.meta.url));

  const envCandidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
    resolve(currentDir, "../../../.env"),
    resolve(currentDir, "../../.env"),
  ];

  for (const candidate of envCandidates) {
    if (existsSync(candidate)) {
      try {
        process.loadEnvFile(candidate);
        if (process.env.DATABASE_URL) {
          break;
        }
      } catch {
        // Continue searching candidates
      }
    }
  }
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgresql://memora:change_me_locally@localhost:5432/memora" },
  strict: true,
  verbose: true
});
