import test from "node:test";
import assert from "node:assert/strict";
import { _internal, parseCliArgs } from "../src/cli.js";

test("parseCliArgs parses command and config path", () => {
  const parsed = parseCliArgs(["ui", "--config", "./custom.json"]);
  assert.equal(parsed.command, "ui");
  assert.equal(parsed.configPath, "./custom.json");
  assert.deepEqual(parsed.rawArgs, []);
});

test("parseCliArgs defaults command to help", () => {
  const parsed = parseCliArgs([]);
  assert.equal(parsed.command, "help");
  assert.equal(parsed.configPath, "");
});

test("parseCliArgs keeps positional args after command", () => {
  const parsed = parseCliArgs(["start", "--verbose"]);
  assert.equal(parsed.command, "start");
  assert.deepEqual(parsed.rawArgs, ["--verbose"]);
});

test("parseCliArgs supports login provider argument", () => {
  const parsed = parseCliArgs(["login", "openai-codex", "--config", "./cfg.json"]);
  assert.equal(parsed.command, "login");
  assert.equal(parsed.configPath, "./cfg.json");
  assert.deepEqual(parsed.rawArgs, ["openai-codex"]);
});

test("normalizeAuthDisplay handles object payload from OAuth provider", () => {
  const display = _internal.normalizeAuthDisplay(
    { url: "https://example.com/auth", instructions: "Paste code" },
    ""
  );
  assert.equal(display.url, "https://example.com/auth");
  assert.equal(display.instructions, "Paste code");
});

test("resolveHttpConfig applies defaults", () => {
  const http = _internal.resolveHttpConfig({});
  assert.equal(http.maxBodyBytes, 1024 * 1024);
  assert.equal(http.requestTimeoutMs, 30000);
});

test("resolveHttpConfig keeps valid values", () => {
  const http = _internal.resolveHttpConfig({
    http: {
      maxBodyBytes: 2048,
      requestTimeoutMs: 45000
    }
  });
  assert.equal(http.maxBodyBytes, 2048);
  assert.equal(http.requestTimeoutMs, 45000);
});
