import { describe, expect, it } from "vitest";

import { createWorkerApp, type AppEnv } from "../index.js";

const env: AppEnv["Bindings"] = {
  DB: {} as D1Database,
  TOKEN_KEY: "token-key",
  CREDENTIAL_KEY: "credential-key",
  INGEST_API_KEY: "ingest-key",
  FETCH_API_KEY: "fetch-key",
  ADMIN_API_KEY: "admin-key",
};

describe("worker", () => {
  it("returns a health payload", async () => {
    const app = createWorkerApp(env);
    const response = await app.request("http://localhost/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects unauthenticated Google Reader requests", async () => {
    const app = createWorkerApp(env);
    const response = await app.request("http://localhost/api/google");

    expect(response.status).toBe(401);
  });

  it("rejects unauthenticated admin requests", async () => {
    const app = createWorkerApp(env);
    const response = await app.request("http://localhost/admin");

    expect([401, 403]).toContain(response.status);
  });
});
