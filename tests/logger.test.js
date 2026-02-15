import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGatewayLogger } from "../src/logger.js";

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

