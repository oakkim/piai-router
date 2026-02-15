import test from "node:test";
import assert from "node:assert/strict";
import { _internal } from "../src/pi-runner.js";

test("buildRunOptions omits temperature for openai-codex-responses", () => {
  const options = _internal.buildRunOptions({
    config: {
      upstream: {
        api: "openai-codex-responses",
        headers: {},
        reasoning: true
      }
    },
    modelRoute: {
      sourceEffort: "medium"
    },
    requestBody: {
      max_tokens: 1024,
      temperature: 0.2
    },
    apiKey: "token"
  });

  assert.equal(options.maxTokens, 1024);
  assert.equal("temperature" in options, false);
});

test("buildRunOptions keeps temperature for non-codex APIs", () => {
  const options = _internal.buildRunOptions({
    config: {
      upstream: {
        api: "openai-responses",
        headers: {},
        reasoning: false
      }
    },
    modelRoute: {},
    requestBody: {
      temperature: 0.7
    },
    apiKey: "token"
  });

  assert.equal(options.temperature, 0.7);
});
