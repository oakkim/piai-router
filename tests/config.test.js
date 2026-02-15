import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { resolveConfigPath, writeConfigFile } from "../src/config-store.js";

test("loadConfig reads config file defaults", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "piai-gateway-config-"));
  const configPath = path.join(tempDir, "gateway.json");

  writeConfigFile(configPath, {
    port: 9999,
    provider: "openai",
    gatewayApiKey: "gateway-token",
    logging: {
      enabled: true,
      server: true,
      conversation: false,
      dir: "./my-logs"
    },
    http: {
      maxBodyBytes: 2048,
      requestTimeoutMs: 45000
    },
    providers: {
      openai: {
        api: "openai-responses",
        authMode: "oauth",
        oauthProvider: "openai-codex",
        authFile: "./piai-auth.json",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-5-mini",
        apiKey: "upstream-token"
      }
    }
  });

  const config = loadConfig({}, { configPath });
  assert.equal(config.port, 9999);
  assert.equal(config.provider, "openai");
  assert.equal(config.platform, "openai");
  assert.equal(config.gatewayApiKey, "gateway-token");
  assert.equal(config.logging.enabled, true);
  assert.equal(config.logging.server, true);
  assert.equal(config.logging.conversation, false);
  assert.equal(config.logging.dir, "./my-logs");
  assert.equal(config.http.maxBodyBytes, 2048);
  assert.equal(config.http.requestTimeoutMs, 45000);
  assert.equal(config.providers.openai.api, "openai-responses");
  assert.equal(config.upstream.provider, "openai");
  assert.equal(config.upstream.api, "openai-responses");
  assert.equal(config.upstream.authMode, "oauth");
  assert.equal(config.upstream.oauthProvider, "openai-codex");
  assert.equal(config.upstream.authFile, "./piai-auth.json");
  assert.equal(config.upstream.defaultModel, "gpt-5-mini");
  assert.equal(config.upstream.apiKey, "upstream-token");
});

test("loadConfig lets environment override file config", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "piai-gateway-config-env-"));
  const configPath = path.join(tempDir, "gateway.json");

  writeConfigFile(configPath, {
    port: 8787,
    upstream: {
      provider: "openai-codex",
      api: "openai-codex-responses",
      defaultModel: "gpt-5.1-codex-mini"
    }
  });

  const config = loadConfig(
    {
      PORT: "4321",
      PI_PROVIDER: "anthropic",
      PI_API: "anthropic-messages",
      PI_MODEL: "claude-sonnet-4-5",
      PIAI_AUTH_MODE: "oauth",
      PIAI_OAUTH_PROVIDER: "anthropic",
      PIAI_AUTH_FILE: "./oauth-auth.json",
      PIAI_LOG_ENABLED: "true",
      PIAI_LOG_SERVER: "false",
      PIAI_LOG_CONVERSATION: "true",
      PIAI_LOG_DIR: "/tmp/piai-logs",
      PIAI_MAX_BODY_BYTES: "4096",
      PIAI_REQUEST_TIMEOUT_MS: "65000"
    },
    { configPath }
  );

  assert.equal(config.port, 4321);
  assert.equal(config.provider, "anthropic");
  assert.equal(config.platform, "anthropic");
  assert.equal(config.upstream.provider, "anthropic");
  assert.equal(config.providers.anthropic.api, "anthropic-messages");
  assert.equal(config.upstream.api, "anthropic-messages");
  assert.equal(config.upstream.defaultModel, "claude-sonnet-4-5");
  assert.equal(config.upstream.authMode, "oauth");
  assert.equal(config.upstream.oauthProvider, "anthropic");
  assert.equal(config.upstream.authFile, "./oauth-auth.json");
  assert.equal(config.logging.enabled, true);
  assert.equal(config.logging.server, false);
  assert.equal(config.logging.conversation, true);
  assert.equal(config.logging.dir, "/tmp/piai-logs");
  assert.equal(config.http.maxBodyBytes, 4096);
  assert.equal(config.http.requestTimeoutMs, 65000);
});

test("loadConfig prefers ROUTER_API_KEY and falls back to GATEWAY_API_KEY", () => {
  const fromRouter = loadConfig({ ROUTER_API_KEY: "router-secret" });
  assert.equal(fromRouter.gatewayApiKey, "router-secret");

  const fromGateway = loadConfig({ GATEWAY_API_KEY: "gateway-secret" });
  assert.equal(fromGateway.gatewayApiKey, "gateway-secret");

  const routerWins = loadConfig({
    ROUTER_API_KEY: "router-secret",
    GATEWAY_API_KEY: "gateway-secret"
  });
  assert.equal(routerWins.gatewayApiKey, "router-secret");
});

test("loadConfig merges model map from file and env", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "piai-gateway-model-map-"));
  const configPath = path.join(tempDir, "gateway.json");
  const modelMapPath = path.join(tempDir, "models.json");

  writeConfigFile(configPath, {
    modelMap: {
      "claude-sonnet-4-5": "gpt-5"
    }
  });
  fs.writeFileSync(modelMapPath, JSON.stringify({ "claude-opus-4-1": "gpt-5-mini" }), "utf-8");

  const config = loadConfig(
    {
      MODEL_MAP_FILE: modelMapPath,
      MODEL_MAP_JSON: JSON.stringify({ default: { "openai-codex": "codex-mini-latest" } })
    },
    { configPath }
  );

  assert.equal(config.modelMap["claude-sonnet-4-5"], "gpt-5");
  assert.equal(config.modelMap["claude-opus-4-1"], "gpt-5-mini");
  assert.equal(config.modelMap.default["openai-codex"], "codex-mini-latest");
});

test("loadConfig keeps backward compatibility with legacy upstream-only config", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "piai-gateway-config-legacy-"));
  const configPath = path.join(tempDir, "gateway.json");

  writeConfigFile(configPath, {
    upstream: {
      provider: "anthropic",
      api: "anthropic-messages",
      authMode: "oauth",
      oauthProvider: "anthropic",
      defaultModel: "claude-sonnet-4-5"
    }
  });

  const config = loadConfig({}, { configPath });
  assert.equal(config.provider, "anthropic");
  assert.equal(config.platform, "anthropic");
  assert.equal(config.upstream.provider, "anthropic");
  assert.equal(config.providers.anthropic.api, "anthropic-messages");
  assert.equal(config.providers.anthropic.defaultModel, "claude-sonnet-4-5");
});

test("loadConfig applies default HTTP guardrails when not configured", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "piai-gateway-config-http-defaults-"));
  const configPath = path.join(tempDir, "gateway.json");

  writeConfigFile(configPath, {
    provider: "openai-codex",
    providers: {
      "openai-codex": {
        api: "openai-codex-responses"
      }
    }
  });

  const config = loadConfig({}, { configPath });
  assert.equal(config.http.maxBodyBytes, 1024 * 1024);
  assert.equal(config.http.requestTimeoutMs, 30000);
});

test("loadConfig rejects invalid auth mode", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "piai-gateway-config-invalid-auth-"));
  const configPath = path.join(tempDir, "gateway.json");

  writeConfigFile(configPath, {
    provider: "openai-codex",
    providers: {
      "openai-codex": {
        api: "openai-codex-responses",
        authMode: "jwt"
      }
    }
  });

  assert.throws(() => loadConfig({}, { configPath }), /Invalid authMode/);
});

test("loadConfig rejects out-of-range port", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "piai-gateway-config-invalid-port-"));
  const configPath = path.join(tempDir, "gateway.json");

  writeConfigFile(configPath, {
    port: 70000,
    provider: "openai-codex",
    providers: {
      "openai-codex": {
        api: "openai-codex-responses"
      }
    }
  });

  assert.throws(() => loadConfig({}, { configPath }), /Invalid port/);
});

test("resolveConfigPath uses home default path when omitted", () => {
  const resolved = resolveConfigPath("", "/tmp/example");
  assert.equal(resolved, path.resolve(os.homedir(), ".pirouter", "config.json"));
});
