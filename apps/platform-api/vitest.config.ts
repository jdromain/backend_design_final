import path from "node:path";
import { defineConfig } from "vitest/config";

const repoRoot = path.resolve(__dirname, "../..");

/** Workspace packages point at `dist/`; Vitest resolves sources so tests run without a full `pnpm build`. */
const rezovoSrc = (pkg: string) =>
  path.join(repoRoot, "packages", pkg, "src", "index.ts");

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
    include: ["src/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    server: {
      deps: {
        inline: [/^@rezovo\//],
      },
    },
  },
});
