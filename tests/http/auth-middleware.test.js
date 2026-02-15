import test from "node:test";
import assert from "node:assert/strict";
import { _internal, createAuthMiddleware } from "../../src/http/auth-middleware.js";

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
  let calledNext = false;

  await assert.rejects(
    () =>
      middleware(
        {
          req: { method: "POST", url: "/v1/messages", headers: { "x-api-key": "bad" } },
          config: { gatewayApiKey: "good" },
          logger: { server: () => {} },
          requestId: "req1"
        },
        async () => {
          calledNext = true;
        }
      ),
    /Invalid API key/
  );

  assert.equal(calledNext, false);
});

test("createAuthMiddleware passes valid key", async () => {
  const middleware = createAuthMiddleware();
  let calledNext = false;

  await middleware(
    {
      req: { method: "POST", url: "/v1/messages", headers: { authorization: "Bearer good" } },
      config: { gatewayApiKey: "good" },
      logger: { server: () => {} },
      requestId: "req2"
    },
    async () => {
      calledNext = true;
    }
  );

  assert.equal(calledNext, true);
});
