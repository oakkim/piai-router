import test from "node:test";
import assert from "node:assert/strict";
import { createCorsMiddleware } from "../src/http/cors-middleware.js";

function createRes() {
  return {
    statusCode: 0,
    headers: {},
    ended: false,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end() {
      this.ended = true;
    }
  };
}

test("createCorsMiddleware handles OPTIONS preflight", async () => {
  const middleware = createCorsMiddleware();
  const res = createRes();
  let calledNext = false;

  await middleware(
    {
      req: { method: "OPTIONS" },
      res
    },
    async () => {
      calledNext = true;
    }
  );

  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
  assert.equal(res.headers["access-control-allow-origin"], "*");
});

test("createCorsMiddleware calls next for non-OPTIONS", async () => {
  const middleware = createCorsMiddleware();
  const res = createRes();
  let calledNext = false;

  await middleware(
    {
      req: { method: "POST" },
      res
    },
    async () => {
      calledNext = true;
    }
  );

  assert.equal(calledNext, true);
});
