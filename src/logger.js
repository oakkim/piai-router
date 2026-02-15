import fs from "node:fs";
import path from "node:path";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function writeJsonLine(filePath, entry) {
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf-8");
}

function resolveLoggingConfig(config) {
  const logging = isRecord(config?.logging) ? config.logging : {};
  const enabled = logging.enabled === true;
  const serverEnabled = enabled && logging.server !== false;
  const conversationEnabled = enabled && logging.conversation !== false;
  const dir = path.resolve(typeof logging.dir === "string" && logging.dir.trim() ? logging.dir : "./logs");
  return { enabled, serverEnabled, conversationEnabled, dir };
}

export function createGatewayLogger(config) {
  const logging = resolveLoggingConfig(config);
  const serverFile = path.join(logging.dir, "server.log.jsonl");
  const conversationFile = path.join(logging.dir, "conversation.log.jsonl");

  if (logging.enabled) {
    ensureDir(logging.dir);
  }

  const safeWrite = (target, entry) => {
    try {
      writeJsonLine(target, entry);
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

  return {
    enabled: logging.enabled,
    serverEnabled: logging.serverEnabled,
    conversationEnabled: logging.conversationEnabled,
    dir: logging.dir,
    serverFile,
    conversationFile,
    server,
    conversation
  };
}

