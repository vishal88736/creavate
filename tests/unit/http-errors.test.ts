import express from "express";
import { afterAll, beforeAll, afterEach, it, expect, vi } from "vitest";
import type { Server } from "node:http";
import { AppError } from "../../packages/shared/src/index.js";
import { handleError } from "../../apps/server/src/errors.js";
let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.post("/api/request", (_req, res) => res.sendStatus(204));
  app.get("/api/protected", () => {
    throw new AppError(401, "Sign in to continue");
  });
  app.get("/api/setup", () => {
    throw new AppError(503, "DATABASE_URL is not configured");
  });
  app.get("/api/failure", () => {
    throw new Error("test-only-private-provider-detail");
  });
  app.use(handleError);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = "http://127.0.0.1:" + (server.address() as { port: number }).port;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
afterEach(() => vi.restoreAllMocks());
it("returns 400 for malformed JSON without logging or exposing its submitted body", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await fetch(
    base + "/api/request?code=test-only-query-value",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"secret":"test-only-body-value",',
    },
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Request body must be valid JSON",
  });
  const logged = warning.mock.calls.map((call) => call.join(" ")).join(" ");
  expect(logged).not.toContain("test-only-body-value");
  expect(logged).not.toContain("test-only-query-value");
  expect(JSON.parse(logged)).toMatchObject({
    level: "warn",
    status: 400,
    method: "POST",
    path: "/api/request",
  });
  expect(errors).not.toHaveBeenCalled();
});
it("returns 413 for oversized JSON before a route runs", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const response = await fetch(base + "/api/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(1100000) }),
  });
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({
    error: "Request body exceeds the 1 MB limit",
  });
});
it("keeps authentication failures denied while distinguishing them from server faults", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await fetch(base + "/api/protected");
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Sign in to continue" });
  expect(JSON.parse(String(warning.mock.calls[0][0]))).toMatchObject({
    level: "warn",
    status: 401,
  });
  expect(errors).not.toHaveBeenCalled();
});
it("keeps a missing configuration error explicit with its real 503 status", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await fetch(base + "/api/setup");
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "DATABASE_URL is not configured",
  });
  expect(JSON.parse(String(errors.mock.calls[0][0]))).toMatchObject({
    level: "error",
    status: 503,
    message: "DATABASE_URL is not configured",
  });
});
it("preserves unexpected server failure status without leaking provider details", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await fetch(base + "/api/failure");
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain(
    "test-only-private-provider-detail",
  );
  expect(String(errors.mock.calls[0][0])).not.toContain(
    "test-only-private-provider-detail",
  );
  expect(JSON.parse(String(errors.mock.calls[0][0]))).toMatchObject({
    level: "error",
    status: 500,
  });
});
