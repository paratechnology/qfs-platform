/* Regenerates the Postgres baseline migration from the schema, without needing a
   live database. `prisma migrate diff --from-empty --to-schema` is pure DDL
   generation, so this works offline.

   Usage: node scripts/gen-baseline.mjs                             */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "prisma", "migrations", "20260926000000_baseline");

/* Invoke the local Prisma CLI directly rather than through npx/shell, so no
   argument string interpolation is involved. */
const prismaCli = join(process.cwd(), "node_modules", "prisma", "build", "index.js");

const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://u:p@localhost:5432/qfs",
  DIRECT_URL: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "postgresql://u:p@localhost:5432/qfs",
};

const out = execFileSync(
  process.execPath,
  [
    prismaCli,
    "migrate",
    "diff",
    "--from-empty",
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--script",
  ],
  { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
);

// Guard: a stray warning in stdout would produce a migration that cannot apply.
if (/^warn |^\s*warn /m.test(out) || !out.trimStart().startsWith("--")) {
  console.error("Refusing to write: output did not look like pure DDL.");
  console.error(out.slice(0, 400));
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const file = join(OUT_DIR, "migration.sql");
writeFileSync(file, out, "utf8");

const lines = out.split("\n").length;
const tables = (out.match(/CREATE TABLE/g) ?? []).length;
const enums = (out.match(/CREATE TYPE/g) ?? []).length;
const indexes = (out.match(/CREATE (UNIQUE )?INDEX/g) ?? []).length;
console.log(`wrote ${file}`);
console.log(`${lines} lines, ${tables} tables, ${enums} enums, ${indexes} indexes`);
