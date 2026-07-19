import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["test-web/**/*.test.js"],
    restoreMocks: true,
  },
});
