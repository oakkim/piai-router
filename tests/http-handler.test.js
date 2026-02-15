import test from "node:test";
import assert from "node:assert/strict";
import { _internal } from "../src/http-handler.js";

test("normalizePathname strips query string", () => {
  assert.equal(_internal.normalizePathname("/v1/messages?beta=true"), "/v1/messages");
  assert.equal(_internal.normalizePathname("/v1/messages/count_tokens?beta=true"), "/v1/messages/count_tokens");
});

test("normalizePathname trims trailing slash for non-root paths", () => {
  assert.equal(_internal.normalizePathname("/v1/messages/"), "/v1/messages");
  assert.equal(_internal.normalizePathname("/"), "/");
});

