import path from "node:path";
import { DEFAULT_LOG_DIR } from "./config-store.js";
import { createLogWriter } from "./log-writer.js";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nowIso() {
  return new Date().toISOString();
}

function resolveLoggingConfig(config) {
  const logging = isRecord(config?.logging) ? config.logging : {};
  const enabled = logging.enabled === true;
  const serverEnabled = enabled && logging.server !== false;
  const conversationEnabled = enabled && logging.conversation !== false;
  const dir = path.resolve(
    typeof logging.dir === "string" && logging.dir.trim()
      ? logging.dir
      : DEFAULT_LOG_DIR,
  );
  const maxQueueSize =
    typeof logging.maxQueueSize === "number" && Number.isFinite(logging.maxQueueSize) && logging.maxQueueSize > 0
      ? Math.floor(logging.maxQueueSize)
      : 5000;
  return { enabled, serverEnabled, conversationEnabled, dir, maxQueueSize };
}

export function createGatewayLogger(config) {
  const logging = resolveLoggingConfig(config);
  const serverFile = path.join(logging.dir, "server.log.jsonl");
  const conversationFile = path.join(logging.dir, "conversation.log.jsonl");

  const writer = logging.enabled
    ? createLogWriter({
        dir: logging.dir,
        maxQueueSize: logging.maxQueueSize
      })
    : null;

  const safeWrite = (target, entry) => {
    if (!writer) {
      return;
    }
    try {
      writer.enqueue(target, `${JSON.stringify(entry)}\n`);
    } catch {
      // Logging must never break request handling.
    }
  };

  const server = (event, data = {}) => {
    if (!logging.serverEnabled) {
      return;
    }
    safeWrite(serverFile, { ts: nowIso(), event, ...data });
  };

  const conversation = (event, data = {}) => {
    if (!logging.conversationEnabled) {
      return;
    }
    safeWrite(conversationFile, { ts: nowIso(), event, ...data });
  };

  const flush = async () => {
    if (!writer) {
      return;
    }
    try {
      await writer.flush();
    } catch {
      // Logging must never break request handling.
    }
  };

  const close = async () => {
    if (!writer) {
      return;
    }
    try {
      await writer.close();
    } catch {
      // Logging must never break request handling.
    }
  };

  const getDroppedCount = () => {
    if (!writer) {
      return 0;
    }
    return writer.getDroppedCount();
  };

  return {
    enabled: logging.enabled,
    serverEnabled: logging.serverEnabled,
    conversationEnabled: logging.conversationEnabled,
    dir: logging.dir,
    serverFile,
    conversationFile,
    server,
    conversation,
    flush,
    close,
    getDroppedCount
  };
}

