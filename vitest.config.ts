import { defineConfig } from "vitest/config";
import path from "node:path";

/* Tests need a real PostgreSQL database, and the suite runs
   `prisma db push --force-reset` against it. That is fine for a throwaway
   database and catastrophic for a real one, so the target is verified to be a
   test database before anything connects. */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DATABASE_URL) {
  throw new Error(
    "\n\n" +
      "TEST_DATABASE_URL is not set.\n\n" +
      "  The suite runs `prisma db push --force-reset` against it, so it must be a\n" +
      "  throwaway database that is never your real one. Create one and set:\n\n" +
      '    TEST_DATABASE_URL="postgresql://USER:PASSWORD@HOST/qfs_test?schema=public"\n' +
      '    TEST_DIRECT_URL="postgresql://USER:PASSWORD@HOST/qfs_test?schema=public"\n\n' +
      "  See .env.example.\n"
  );
}

if (!/test/i.test(new URL(TEST_DATABASE_URL).pathname)) {
  throw new Error(
    "\n\n" +
      `Refusing to run: the TEST_DATABASE_URL database name does not contain "test".\n\n` +
      `  ${TEST_DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}\n\n` +
      "  The suite force-resets this database before every run. Point it at a\n" +
      "  dedicated qfs_test database, not the one your app uses.\n"
  );
}

const DIRECT_URL =
  process.env.TEST_DIRECT_URL ?? process.env.TEST_DATABASE_URL ?? TEST_DATABASE_URL;

export default defineConfig({
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "tests/setup/server-only.ts"),
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["./tests/setup/global-setup.ts"],
    /* All suites share one PostgreSQL database — run files sequentially so each
       file's resetDb() doesn't clobber another suite's rows mid-test. */
    fileParallelism: false,
    maxWorkers: 1,
    isolate: false,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      DIRECT_URL,
      CRON_SECRET: "qfs-cron-test",
      SESSION_SECRET: "qfs-test-session-secret-value-32chars-min",
      NODE_ENV: "test",
    },
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
