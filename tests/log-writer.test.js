import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLogWriter } from "../src/log-writer.js";

test("createLogWriter writes queued log lines", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "piai-gateway-log-writer-"));
  const writer = createLogWriter({ dir: tempDir });
  const filePath = path.join(tempDir, "test.log");

  writer.enqueue(filePath, '{"event":"one"}\n');
  writer.enqueue(filePath, '{"event":"two"}\n');
  await writer.flush();

  const content = fs.readFileSync(filePath, "utf-8");
  assert.match(content, /"event":"one"/);
  assert.match(content, /"event":"two"/);
});

test("createLogWriter tracks dropped entries when queue is full", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "piai-gateway-log-writer-drop-"));
  const writer = createLogWriter({ dir: tempDir, maxQueueSize: 1 });
  const filePath = path.join(tempDir, "test.log");

  for (let i = 0; i < 200; i += 1) {
    writer.enqueue(filePath, `{"event":"${i}"}\n`);
  }
  await writer.flush();

  assert.equal(writer.getDroppedCount() > 0, true);
});

test("createLogWriter does not enqueue after close", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "piai-gateway-log-writer-close-"));
  const writer = createLogWriter({ dir: tempDir });
  const filePath = path.join(tempDir, "test.log");

  writer.enqueue(filePath, '{"event":"one"}\n');
  await writer.close();
  const accepted = writer.enqueue(filePath, '{"event":"two"}\n');
  await writer.flush();

  assert.equal(accepted, false);
  const content = fs.readFileSync(filePath, "utf-8");
  assert.match(content, /"event":"one"/);
  assert.doesNotMatch(content, /"event":"two"/);
});
