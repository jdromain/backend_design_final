import path from "node:path";
import { defineConfig } from "vitest/config";

const repoRoot = path.resolve(__dirname, "../..");

const rezovoSrc = (pkg: string) =>
  path.join(repoRoot, "packages", pkg, "src", "index.ts");

/** Runs only `*.integration.test.ts` in an isolated Vitest process (avoids env import races with contract tests). */
export default defineConfig({
  resolve: {
    alias: {
      "@rezovo/event-bus": rezovoSrc("event-bus"),
      "@rezovo/logging": rezovoSrc("logging"),
      "@rezovo/core-types": rezovoSrc("core-types"),
      "@rezovo/utils": rezovoSrc("utils"),
      "@rezovo/vector-store": rezovoSrc("vector-store"),
    },
  },
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    server: {
      deps: {
        inline: [/^@rezovo\//],
      },
    },
  },
});
