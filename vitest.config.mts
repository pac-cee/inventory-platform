import { defineConfig } from "vitest/config";

// Unit tests for pure logic, and components rendered to a string with
// react-dom/server — still no DOM and no Next runtime, so the environment stays
// plain node. A component that needs events or layout does not belong here.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
