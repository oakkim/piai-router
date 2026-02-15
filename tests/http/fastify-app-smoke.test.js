import test from "node:test";
import assert from "node:assert/strict";
import { createFastifyApp } from "../../src/http/fastify-app.js";

function createConfig(overrides = {}) {
  const base = {
    port: 8787,
    provider: "openai-codex",
    platform: "openai-codex",
    modelMap: {},
    gatewayApiKey: "",
    http: {
      maxBodyBytes: 1024 * 1024,
      requestTimeoutMs: 30000
    },
    upstream: {
      provider: "openai-codex",
      api: "openai-codex-responses",
      defaultModel: "gpt-5",
      authMode: "apiKey",
      apiKey: "upstream-key"
    }
  };

  return {
    ...base,
    ...overrides,
    http: {
      ...base.http,
      ...(overrides.http || {})
    },
    upstream: {
      ...base.upstream,
      ...(overrides.upstream || {})
    },
    modelMap: overrides.modelMap || base.modelMap
  };
}

function createLogger() {
  const entries = {
    server: [],
    conversation: []
  };
  return {
    entries,
    server(event, data = {}) {
      entries.server.push({ event, data });
    },
    conversation(event, data = {}) {
      entries.conversation.push({ event, data });
    }
  };
}

function createRunner(overrides = {}) {
  return {
    complete: async () => ({
      content: [{ type: "text", text: "ok" }],
      stopReason: "stop",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }
    }),
    stream: async () =>
      (async function* () {
        yield { type: "start" };
        yield { type: "text_start", contentIndex: 0 };
        yield { type: "text_delta", contentIndex: 0, delta: "ok" };
        yield { type: "text_end", contentIndex: 0, content: "ok" };
        yield {
          type: "done",
          message: {
            content: [{ type: "text", text: "ok" }],
            stopReason: "stop",
            usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }
          }
        };
      })(),
    ...overrides
  };
}

test("createFastifyApp serves health endpoint", async () => {
  const logger = createLogger();
  const app = createFastifyApp({
    config: createConfig(),
    runner: createRunner(),
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
    config: createConfig(),
    runner: createRunner(),
    logger
  });

  await app.inject({
    method: "GET",
    url: "/health"
  });

  assert.equal(logger.entries.server.some((entry) => entry.event === "http_access"), true);

  await app.close();
});

test("createFastifyApp handles /v1/models via shared router", async () => {
  const logger = createLogger();
  const app = createFastifyApp({
    config: createConfig(),
    runner: createRunner(),
    logger
  });

  const response = await app.inject({
    method: "GET",
    url: "/v1/models"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.object, "list");
  assert.equal(Array.isArray(body.data), true);

  await app.close();
});

test("createFastifyApp handles /v1/messages/count_tokens", async () => {
  const logger = createLogger();
  const app = createFastifyApp({
    config: createConfig(),
    runner: createRunner(),
    logger
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/messages/count_tokens",
    payload: {
      model: "gpt-5",
      messages: [{ role: "user", content: "hello token counter" }]
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(typeof body.input_tokens, "number");
  assert.equal(body.input_tokens > 0, true);

  await app.close();
});

test("createFastifyApp handles /v1/messages non-stream", async () => {
  const logger = createLogger();
  const app = createFastifyApp({
    config: createConfig(),
    runner: createRunner(),
    logger
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/messages",
    payload: {
      model: "gpt-5",
      stream: false,
      messages: [{ role: "user", content: "hi" }]
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.type, "message");
  assert.equal(body.role, "assistant");

  await app.close();
});

test("createFastifyApp handles /v1/messages stream", async () => {
  const logger = createLogger();
  const app = createFastifyApp({
    config: createConfig(),
    runner: createRunner(),
    logger
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/messages",
    payload: {
      model: "gpt-5",
      stream: true,
      messages: [{ role: "user", content: "stream please" }]
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["content-type"] || ""), /text\/event-stream/);
  assert.match(response.body, /event: message_start/);

  await app.close();
});

test("createFastifyApp returns 404 anthropic error for unknown route", async () => {
  const logger = createLogger();
  const app = createFastifyApp({
    config: createConfig(),
    runner: createRunner(),
    logger
  });

  const response = await app.inject({
    method: "GET",
    url: "/not-found"
  });

  assert.equal(response.statusCode, 404);
  const body = response.json();
  assert.equal(body.type, "error");
  assert.equal(body.error.type, "not_found_error");

  await app.close();
});
