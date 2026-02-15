import test from "node:test";
import assert from "node:assert/strict";
import { createErrorMiddleware } from "../../src/http/error-middleware.js";
import { GatewayHttpError } from "../../src/http/http-errors.js";

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

test("error middleware maps GatewayHttpError", async () => {
  const middleware = createErrorMiddleware();
  const res = createRes();

  await middleware(
    {
      req: { method: "POST", url: "/v1/messages" },
      res,
      logger: { server: () => {} },
      requestId: "req1"
    },
    async () => {
      throw new GatewayHttpError(401, "authentication_error", "Invalid API key");
    }
  );

  assert.equal(res.statusCode, 401);
  assert.match(res.body, /authentication_error/);
  assert.match(res.body, /Invalid API key/);
});

test("error middleware hides generic internal errors", async () => {
  const middleware = createErrorMiddleware();
  const res = createRes();

  await middleware(
    {
      req: { method: "POST", url: "/v1/messages" },
      res,
      logger: { server: () => {} },
      requestId: "req2"
    },
    async () => {
      throw new Error("boom");
    }
  );

  assert.equal(res.statusCode, 500);
  assert.match(res.body, /Internal server error/);
  assert.doesNotMatch(res.body, /boom/);
});
