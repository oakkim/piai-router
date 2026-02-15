import test from "node:test";
import assert from "node:assert/strict";
import { _internal, createAuthMiddleware } from "../src/http/auth-middleware.js";

function createRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    headersSent: false,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
      this.headersSent = true;
    },
    end(body = "") {
      this.body = body;
      this.headersSent = true;
    }
  };
}

test("extractApiToken prefers x-api-key over authorization", () => {
  const token = _internal.extractApiToken({
    headers: {
      "x-api-key": "token-from-x",
      authorization: "Bearer token-from-auth"
    }
  });
  assert.equal(token, "token-from-x");
});

test("validateGatewayApiKey allows requests when no gateway key set", () => {
  const ok = _internal.validateGatewayApiKey({ headers: {} }, { gatewayApiKey: "" });
  assert.equal(ok, true);
});

test("createAuthMiddleware blocks invalid key", async () => {
  const middleware = createAuthMiddleware();
  const res = createRes();
  let calledNext = false;

  await middleware(
    {
      req: { method: "POST", url: "/v1/messages", headers: { "x-api-key": "bad" } },
      res,
      config: { gatewayApiKey: "good" },
      logger: { server: () => {} },
      requestId: "req1"
    },
    async () => {
      calledNext = true;
    }
  );

  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 401);
  assert.match(res.body, /Invalid API key/);
});

test("createAuthMiddleware passes valid key", async () => {
  const middleware = createAuthMiddleware();
  const res = createRes();
  let calledNext = false;

  await middleware(
    {
      req: { method: "POST", url: "/v1/messages", headers: { authorization: "Bearer good" } },
      res,
      config: { gatewayApiKey: "good" },
      logger: { server: () => {} },
      requestId: "req2"
    },
    async () => {
      calledNext = true;
    }
  );

  assert.equal(calledNext, true);
  assert.equal(res.statusCode, 0);
});
