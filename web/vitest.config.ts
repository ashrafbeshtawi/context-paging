import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    fileParallelism: false,
    // Own database, see ../tests/global-setup.ts.
    globalSetup: ["../tests/global-setup.ts"],
    env: { PG_DATABASE: process.env.PG_TEST_DATABASE || "context_paging_test" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "@agent": path.resolve(__dirname, "../src"),
    },
  },
});
