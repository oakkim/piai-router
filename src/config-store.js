import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".pirouter", "config.json");
export const DEFAULT_DATA_DIR = path.dirname(DEFAULT_CONFIG_PATH);
export const DEFAULT_LOG_DIR = path.join(DEFAULT_DATA_DIR, "logs");

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function expandHomePath(filePath) {
  const raw = typeof filePath === "string" ? filePath.trim() : "";
  if (!raw) {
    return raw;
  }
  if (raw === "~") {
    return os.homedir();
  }
  if (raw.startsWith("~/") || raw.startsWith("~\\")) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

export function resolveConfigPath(configPath, cwd = process.cwd()) {
  const raw = typeof configPath === "string" ? configPath.trim() : "";
  if (!raw) {
    return DEFAULT_CONFIG_PATH;
  }
  return path.resolve(cwd, expandHomePath(raw));
}

export function readConfigFile(configPath) {
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeConfigFile(configPath, value) {
  const parentDir = path.dirname(configPath);
  fs.mkdirSync(parentDir, { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

export function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeJsonFile(filePath, value) {
  const parentDir = path.dirname(filePath);
  fs.mkdirSync(parentDir, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}
