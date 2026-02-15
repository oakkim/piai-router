import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getOAuthProvider,
  readAuthStore,
  resolveAuthFilePath,
  writeAuthStore
} from "../src/oauth-auth.js";

test("resolveAuthFilePath resolves relative to config file directory", () => {
  const config = {
    configPath: "/tmp/work/piai-router.config.json",
    upstream: { authFile: "./auth/piai-auth.json" }
  };
  const resolved = resolveAuthFilePath(config);
  assert.equal(resolved, path.resolve("/tmp/work", "auth/piai-auth.json"));
});

test("resolveAuthFilePath expands tilde path", () => {
  const config = {
    configPath: "/tmp/work/piai-router.config.json",
    upstream: { authFile: "~/.pirouter/auth.json" }
  };
  const resolved = resolveAuthFilePath(config);
  assert.equal(resolved, path.join(os.homedir(), ".pirouter", "auth.json"));
});

test("getOAuthProvider resolves from explicit/provider defaults", () => {
  const config = {
    provider: "openai-codex",
    upstream: {
      oauthProvider: "openai-codex",
      provider: "openai-codex"
    }
  };
  assert.equal(getOAuthProvider(config, ""), "openai-codex");
  assert.equal(getOAuthProvider(config, "anthropic"), "anthropic");
  assert.equal(getOAuthProvider(config, "unsupported-provider"), "");
});

test("readAuthStore/writeAuthStore roundtrip", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "piai-gateway-auth-"));
  const authFile = path.join(tempDir, "piai-auth.json");
  const store = {
    "openai-codex": {
      type: "oauth",
      accessToken: "token",
      expiresAt: Date.now() + 1000
    }
  };
  writeAuthStore(authFile, store);
  const loaded = readAuthStore(authFile);
  assert.equal(loaded["openai-codex"].type, "oauth");
  assert.equal(loaded["openai-codex"].accessToken, "token");
});
