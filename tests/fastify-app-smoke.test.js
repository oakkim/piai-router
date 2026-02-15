import test from "node:test";
import assert from "node:assert/strict";
import { createFastifyApp } from "../src/http/fastify-app.js";

function createLogger() {
  const entries = [];
  return {
    entries,
    server(event, data = {}) {
      entries.push({ event, data });
    }
  };
}

test("createFastifyApp serves health endpoint", async () => {
  const logger = createLogger();
  const app = createFastifyApp({
    config: {
      port: 8787
    },
    logger
  });

  const response = await app.inject({
    method: "GET",
    url: "/health"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"].includes("application/json"), true);
  assert.deepEqual(response.json(), { ok: true });
  assert.equal(typeof response.headers["x-request-id"], "string");

  await app.close();
});

test("createFastifyApp writes access log on response", async () => {
  const logger = createLogger();
  const app = createFastifyApp({
    config: {
      port: 8787
    },
    logger
  });

  await app.inject({
    method: "GET",
    url: "/health"
  });

  assert.equal(logger.entries.some((entry) => entry.event === "http_access"), true);

  await app.close();
});
