import { execSync } from "node:child_process";
import path from "node:path";

/**
 * Reset the test database to a clean, migrated schema before the suite runs.
 * Runs `prisma db push --force-reset` against the TEST_DATABASE_URL that
 * vitest.config.ts already validated to be a dedicated test database.
 *
 * `db push` is used rather than `migrate deploy` so tests do not depend on
 * migration history being in sync — they only need the current shape.
 */
export default function globalSetup() {
  const projectRoot = path.resolve(__dirname, "../..");
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. The suite force-resets this database, so it must be a dedicated test one. See .env.example."
    );
  }

  execSync("npx prisma db push --force-reset --skip-generate", {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: url,
      DIRECT_URL: process.env.TEST_DIRECT_URL ?? url,
    },
  });
}
