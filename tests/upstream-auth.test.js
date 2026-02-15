import test from "node:test";
import assert from "node:assert/strict";
import { extractApiToken, getUpstreamApiKey } from "../src/http/upstream-auth.js";

test("extractApiToken reads bearer token", () => {
  const token = extractApiToken({ headers: { authorization: "Bearer abc" } });
  assert.equal(token, "abc");
});

test("getUpstreamApiKey prefers configured upstream api key", () => {
  const token = getUpstreamApiKey(
    { headers: { authorization: "Bearer abc" } },
    { upstream: { authMode: "apiKey", apiKey: "configured" } }
  );
  assert.equal(token, "configured");
});

test("getUpstreamApiKey uses request token when no configured key", () => {
  const token = getUpstreamApiKey(
    { headers: { "x-api-key": "request-key" } },
    { upstream: { authMode: "apiKey", apiKey: "" } }
  );
  assert.equal(token, "request-key");
});

test("getUpstreamApiKey returns empty string for oauth mode", () => {
  const token = getUpstreamApiKey(
    { headers: { authorization: "Bearer abc" } },
    { upstream: { authMode: "oauth", apiKey: "configured" } }
  );
  assert.equal(token, "");
});
