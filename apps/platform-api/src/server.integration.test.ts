import { readFileSync } from "node:fs";
import path from "node:path";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";

/** Repo `database/` when tests run with cwd `apps/platform-api`. */
const databaseDir = path.resolve(process.cwd(), "..", "..", "database");

vi.mock("./auth/clerk", () => ({
  isClerkEnabled: true,
  verifyClerkToken: vi.fn(async (_token: string) => ({
    sub: "clerk-integration-user",
    email: "admin@example.com",
    orgId: "org_localdemo",
  })),
  getClerkBackendClient: vi.fn(),
}));

describe.skipIf(process.env.SKIP_TESTCONTAINERS === "true")(
  "platform-api with real Postgres (Testcontainers)",
  () => {
    let container: StartedPostgreSqlContainer;
    let app: Awaited<ReturnType<typeof import("./server").buildServer>>;

    beforeAll(async () => {
      process.env.VITEST = "true";
      process.env.CLERK_AUTH_ENABLED = "true";
      process.env.CLERK_SECRET_KEY = "sk_test_integration";
      process.env.CLERK_JWT_PUBLIC_KEY = "pk_test_integration";
      process.env.CLERK_WEBHOOK_SECRET = "whsec_integration";
      process.env.INTERNAL_SERVICE_TOKEN = "integration-internal-token";
      process.env.REDIS_ENABLED = "false";
      process.env.EVENT_BUS_IMPL = "memory";

      container = await new PostgreSqlContainer("pgvector/pgvector:pg15")
        .withDatabase("rezovo")
        .withUsername("rezovo")
        .withPassword("rezovo_local")
        .start();

      process.env.DATABASE_URL = container.getConnectionUri();

      const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      for (const f of ["setup_complete.sql", "002_ui_tables.sql", "004_call_failure_type.sql", "006_org_id_canonical_cutover.sql"]) {
        const sql = readFileSync(path.join(databaseDir, f), "utf8");
        await client.query(sql);
      }
      await client.end();

      const { buildServer } = await import("./server");
      const { createInMemoryEventBus } = await import("@rezovo/event-bus");
      app = buildServer(createInMemoryEventBus());
      await app.ready();
    }, 120_000);

    afterAll(async () => {
      await app?.close();
      await container?.stop();
    });

    it("GET /ready reports database ready", async () => {
      const res = await app.inject({ method: "GET", url: "/ready" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ready).toBe(true);
    });

    it("Clerk auth + GET /calls returns { data } for org-local organization", async () => {
      const calls = await app.inject({
        method: "GET",
        url: "/calls",
        headers: { authorization: "Bearer integration-clerk-token" },
      });
      expect(calls.statusCode).toBe(200);
      expect(Array.isArray(calls.json().data)).toBe(true);
    });
  }
);
