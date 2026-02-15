import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGatewayLogger } from "../src/logger.js";
import { sanitizeForLogging } from "../src/http/handlers/messages-handler.js";

test("createGatewayLogger writes server and conversation logs when enabled", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "piai-gateway-logger-enabled-"));
  const logger = createGatewayLogger({
    logging: {
      enabled: true,
      server: true,
      conversation: true,
      dir: tempDir
    }
  });

  logger.server("server_start", { port: 8787 });
  logger.conversation("request", { requestId: "req1", model: "claude-sonnet-4-5" });
  await logger.flush();

  const serverLog = fs.readFileSync(path.join(tempDir, "server.log.jsonl"), "utf-8");
  const conversationLog = fs.readFileSync(path.join(tempDir, "conversation.log.jsonl"), "utf-8");

  assert.match(serverLog, /"event":"server_start"/);
  assert.match(conversationLog, /"event":"request"/);
});

test("createGatewayLogger does not write logs when disabled", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "piai-gateway-logger-disabled-"));
  const logger = createGatewayLogger({
    logging: {
      enabled: false,
      server: true,
      conversation: true,
      dir: tempDir
    }
  });

  logger.server("server_start", { port: 8787 });
  logger.conversation("request", { requestId: "req1" });
  await logger.flush();

  assert.equal(fs.existsSync(path.join(tempDir, "server.log.jsonl")), false);
  assert.equal(fs.existsSync(path.join(tempDir, "conversation.log.jsonl")), false);
});

test("createGatewayLogger can disable only conversation logs", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "piai-gateway-logger-selective-"));
  const logger = createGatewayLogger({
    logging: {
      enabled: true,
      server: true,
      conversation: false,
      dir: tempDir
    }
  });

  logger.server("http_access", { requestId: "req1" });
  logger.conversation("request", { requestId: "req1" });
  await logger.flush();

  assert.equal(fs.existsSync(path.join(tempDir, "server.log.jsonl")), true);
  assert.equal(fs.existsSync(path.join(tempDir, "conversation.log.jsonl")), false);
});

test("createGatewayLogger reports dropped logs when queue overflows", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "piai-gateway-logger-overflow-"));
  const logger = createGatewayLogger({
    logging: {
      enabled: true,
      server: true,
      conversation: true,
      dir: tempDir,
      maxQueueSize: 1
    }
  });

  logger.server("event-1", { requestId: "req1" });
  logger.server("event-2", { requestId: "req2" });
  await logger.flush();

  assert.equal(typeof logger.getDroppedCount(), "number");
});

test("sanitizeForLogging redacts sensitive fields deeply and preserves shape", () => {
  const input = {
    apiKey: "secret-key",
    nested: {
      Authorization: "Bearer token",
      data: [{ password: "p@ss" }, { value: 123 }]
    },
    array: [{ x_api_key: "hidden" }, { ok: true }],
    token: "abc",
    normal: "keep"
  };

  const sanitized = sanitizeForLogging(input);

  assert.equal(sanitized.apiKey, "[REDACTED]");
  assert.equal(sanitized.nested.Authorization, "[REDACTED]");
  assert.equal(sanitized.nested.data[0].password, "[REDACTED]");
  assert.equal(sanitized.array[0].x_api_key, "[REDACTED]");
  assert.equal(sanitized.normal, "keep");
  assert.equal(sanitized.token, "[REDACTED]");
  // original unchanged
  assert.equal(input.apiKey, "secret-key");
});

test("sanitizeForLogging handles circular references", () => {
  const obj = { token: "top" };
  obj.self = obj;
  const sanitized = sanitizeForLogging(obj);
  assert.equal(sanitized.token, "[REDACTED]");
  assert.equal(sanitized.self, "[Circular]");
});

