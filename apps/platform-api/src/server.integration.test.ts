import { readFileSync } from "node:fs";
import path from "node:path";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import jwt from "jsonwebtoken";

/** Repo `database/` when tests run with cwd `apps/platform-api`. */
const databaseDir = path.resolve(process.cwd(), "..", "..", "database");

describe.skipIf(process.env.SKIP_TESTCONTAINERS === "true")(
  "platform-api with real Postgres (Testcontainers)",
  () => {
    let container: StartedPostgreSqlContainer;
    let app: Awaited<ReturnType<typeof import("./server").buildServer>>;
    const jwtSecret = "integration-test-jwt-secret";

    beforeAll(async () => {
      process.env.VITEST = "true";
      process.env.JWT_SECRET = jwtSecret;
      process.env.CLERK_AUTH_ENABLED = "false";
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
      for (const f of ["setup_complete.sql", "002_ui_tables.sql", "003_clerk_tenant_mapping.sql"]) {
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

    it("dev JWT login + GET /calls returns { data } for test-tenant", async () => {
      const login = await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: "admin@example.com" },
      });
      expect(login.statusCode).toBe(200);
      const { token } = login.json() as { token: string };
      expect(token).toBeTruthy();

      const payload = jwt.verify(token, jwtSecret) as { tenant_id: string };
      expect(payload.tenant_id).toBe("test-tenant");

      const calls = await app.inject({
        method: "GET",
        url: "/calls",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(calls.statusCode).toBe(200);
      expect(Array.isArray(calls.json().data)).toBe(true);
    });
  }
);
