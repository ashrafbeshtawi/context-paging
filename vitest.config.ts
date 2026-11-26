import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    // Own database, see tests/global-setup.ts.
    globalSetup: ["./tests/global-setup.ts"],
    env: { PG_DATABASE: process.env.PG_TEST_DATABASE || "context_paging_test" },
  },
});
