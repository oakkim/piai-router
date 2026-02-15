import test from "node:test";
import assert from "node:assert/strict";
import { _internal as routerInternal } from "../src/http/router.js";
import { _internal as handlerInternal } from "../src/http-handler.js";

test("router normalizePathname strips query string", () => {
  assert.equal(routerInternal.normalizePathname("/v1/messages?beta=true"), "/v1/messages");
  assert.equal(
    routerInternal.normalizePathname("/v1/messages/count_tokens?beta=true"),
    "/v1/messages/count_tokens"
  );
});

test("router normalizePathname trims trailing slash for non-root paths", () => {
  assert.equal(routerInternal.normalizePathname("/v1/messages/"), "/v1/messages");
  assert.equal(routerInternal.normalizePathname("/"), "/");
});

test("legacy handler normalizePathname strips query string", () => {
  assert.equal(handlerInternal.normalizePathname("/v1/messages?beta=true"), "/v1/messages");
  assert.equal(
    handlerInternal.normalizePathname("/v1/messages/count_tokens?beta=true"),
    "/v1/messages/count_tokens"
  );
});

