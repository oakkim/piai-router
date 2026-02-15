import test from "node:test";
import assert from "node:assert/strict";
import { createRouter } from "../src/http/router.js";
import { GatewayHttpError } from "../src/http/http-errors.js";

function createConfig(overrides = {}) {
  const base = {
    provider: "openai-codex",
    platform: "openai-codex",
    modelMap: {},
    http: {
      maxBodyBytes: 1024 * 1024,
      requestTimeoutMs: 30000
    },
    upstream: {
      provider: "openai-codex",
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

function createReq({ method = "GET", url = "/", headers = {}, body } = {}) {
  const payload =
    body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);

  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      if (payload !== null) {
        yield Buffer.from(payload);
      }
    }
  };
}

function createRes() {
  return {
    statusCode: 0,
    headers: {},
    chunks: [],
    headersSent: false,
    ended: false,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
      this.headersSent = true;
    },
    write(chunk) {
      this.chunks.push(String(chunk));
      this.headersSent = true;
    },
    end(chunk = "") {
      if (chunk) {
        this.chunks.push(String(chunk));
      }
      this.ended = true;
      this.headersSent = true;
    },
    bodyText() {
      return this.chunks.join("");
    }
  };
}

test("router handles /health", async () => {
  const logger = createLogger();
  const route = createRouter({
    config: createConfig(),
    runner: {
      complete: async () => {
        throw new Error("not used");
      },
      stream: async () => {
        throw new Error("not used");
      }
    },
    logger
  });

  const req = createReq({ method: "GET", url: "/health" });
  const res = createRes();

  await route({ req, res, logger, requestId: "req-health" });

  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.bodyText()).ok, true);
});

test("router handles /v1/models", async () => {
  const logger = createLogger();
  const route = createRouter({
    config: createConfig({
      modelMap: {
        "openai-codex:gpt-5-haiku": "gpt-5-mini",
        default: "gpt-5"
      }
    }),
    runner: {
      complete: async () => {
        throw new Error("not used");
      },
      stream: async () => {
        throw new Error("not used");
      }
    },
    logger
  });

  const req = createReq({ method: "GET", url: "/v1/models" });
  const res = createRes();

  await route({ req, res, logger, requestId: "req-models" });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.bodyText());
  assert.equal(body.object, "list");
  assert.equal(Array.isArray(body.data), true);
  assert.equal(logger.entries.server.some((entry) => entry.event === "models_list"), true);
});

test("router handles /v1/messages/count_tokens", async () => {
  const logger = createLogger();
  const route = createRouter({
    config: createConfig(),
    runner: {
      complete: async () => {
        throw new Error("not used");
      },
      stream: async () => {
        throw new Error("not used");
      }
    },
    logger
  });

  const req = createReq({
    method: "POST",
    url: "/v1/messages/count_tokens",
    body: {
      model: "gpt-5",
      messages: [{ role: "user", content: "hello token counter" }]
    }
  });
  const res = createRes();

  await route({ req, res, logger, requestId: "req-count" });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.bodyText());
  assert.equal(typeof body.input_tokens, "number");
  assert.equal(body.input_tokens > 0, true);
});

test("router handles /v1/messages non-stream success", async () => {
  const logger = createLogger();
  const calls = [];
  const route = createRouter({
    config: createConfig(),
    runner: {
      complete: async (payload) => {
        calls.push(payload);
        return {
          content: [{ type: "text", text: "hello" }],
          stopReason: "stop",
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }
        };
      },
      stream: async () => {
        throw new Error("not used");
      }
    },
    logger
  });

  const req = createReq({
    method: "POST",
    url: "/v1/messages",
    body: {
      model: "gpt-5",
      stream: false,
      messages: [{ role: "user", content: "hi" }]
    }
  });
  const res = createRes();

  await route({ req, res, logger, requestId: "req-msg" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].apiKey, "upstream-key");
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.bodyText());
  assert.equal(body.type, "message");
  assert.equal(body.role, "assistant");
});

test("router handles /v1/messages stream success", async () => {
  const logger = createLogger();
  const route = createRouter({
    config: createConfig(),
    runner: {
      complete: async () => {
        throw new Error("not used");
      },
      stream: async () =>
        (async function* () {
          yield { type: "start" };
          yield { type: "text_start", contentIndex: 0 };
          yield { type: "text_delta", contentIndex: 0, delta: "hi" };
          yield { type: "text_end", contentIndex: 0, content: "hi" };
          yield { type: "error", error: { errorMessage: "temporary upstream warning" } };
          yield {
            type: "done",
            reason: "stop",
            message: {
              content: [{ type: "text", text: "hi" }],
              stopReason: "stop",
              usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }
            }
          };
        })()
    },
    logger
  });

  const req = createReq({
    method: "POST",
    url: "/v1/messages",
    body: {
      model: "gpt-5",
      stream: true,
      messages: [{ role: "user", content: "stream please" }]
    }
  });
  const res = createRes();

  await route({ req, res, logger, requestId: "req-stream" });

  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /text\/event-stream/);
  assert.equal(res.ended, true);
  assert.match(res.bodyText(), /event: message_start/);
  assert.match(res.bodyText(), /temporary upstream warning/);
});

test("router handles stream setup failure with SSE error record", async () => {
  const logger = createLogger();
  const route = createRouter({
    config: createConfig(),
    runner: {
      complete: async () => {
        throw new Error("not used");
      },
      stream: async () => {
        throw new Error("stream unavailable");
      }
    },
    logger
  });

  const req = createReq({
    method: "POST",
    url: "/v1/messages",
    body: {
      model: "gpt-5",
      stream: true,
      messages: [{ role: "user", content: "stream fail" }]
    }
  });
  const res = createRes();

  await route({ req, res, logger, requestId: "req-stream-fail" });

  assert.equal(res.statusCode, 200);
  assert.match(res.bodyText(), /Upstream stream failed/);
  assert.equal(res.ended, true);
});

test("router throws typed errors for upstream failure and unknown route", async () => {
  const logger = createLogger();
  const route = createRouter({
    config: createConfig(),
    runner: {
      complete: async () => {
        throw new Error("upstream exploded");
      },
      stream: async () => {
        throw new Error("not used");
      }
    },
    logger
  });

  const failReq = createReq({
    method: "POST",
    url: "/v1/messages",
    body: {
      model: "gpt-5",
      stream: false,
      messages: [{ role: "user", content: "fail" }]
    }
  });

  await assert.rejects(
    () => route({ req: failReq, res: createRes(), logger, requestId: "req-fail" }),
    (error) => {
      assert.equal(error instanceof GatewayHttpError, true);
      assert.equal(error.statusCode, 502);
      return true;
    }
  );

  const notFoundReq = createReq({ method: "GET", url: "/unknown" });
  await assert.rejects(
    () => route({ req: notFoundReq, res: createRes(), logger, requestId: "req-miss" }),
    (error) => {
      assert.equal(error instanceof GatewayHttpError, true);
      assert.equal(error.statusCode, 404);
      return true;
    }
  );

  assert.equal(logger.entries.server.some((entry) => entry.event === "route_not_found"), true);
});

test("router throws missing upstream key error", async () => {
  const logger = createLogger();
  const route = createRouter({
    config: createConfig({
      upstream: {
        authMode: "apiKey",
        apiKey: ""
      }
    }),
    runner: {
      complete: async () => ({
        content: [{ type: "text", text: "unused" }],
        stopReason: "stop",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }
      }),
      stream: async () => {
        throw new Error("not used");
      }
    },
    logger
  });

  const req = createReq({
    method: "POST",
    url: "/v1/messages",
    body: {
      model: "gpt-5",
      stream: false,
      messages: [{ role: "user", content: "hi" }]
    }
  });

  await assert.rejects(
    () => route({ req, res: createRes(), logger, requestId: "req-no-key" }),
    (error) => {
      assert.equal(error instanceof GatewayHttpError, true);
      assert.equal(error.statusCode, 500);
      return true;
    }
  );
});
