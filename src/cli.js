import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig } from "./config.js";
import {
  readConfigFile,
  resolveConfigPath,
  writeConfigFile,
} from "./config-store.js";
import { getOAuthProvider, runOAuthLogin } from "./oauth-auth.js";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProviderId(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeProviderConfigShape(input, providerId) {
  const source = isRecord(input) ? input : {};
  const resolvedProvider = normalizeProviderId(providerId) || "openai-codex";
  return {
    api:
      typeof source.api === "string" && source.api.trim()
        ? source.api.trim()
        : "openai-codex-responses",
    authMode:
      typeof source.authMode === "string" && source.authMode.trim()
        ? source.authMode.trim()
        : "apiKey",
    oauthProvider:
      typeof source.oauthProvider === "string" && source.oauthProvider.trim()
        ? source.oauthProvider.trim()
        : resolvedProvider,
    authFile:
      typeof source.authFile === "string" && source.authFile.trim()
        ? source.authFile.trim()
        : "./piai-auth.json",
    baseUrl:
      typeof source.baseUrl === "string" && source.baseUrl.trim()
        ? source.baseUrl.trim()
        : "",
    apiKey: typeof source.apiKey === "string" ? source.apiKey : "",
    defaultModel:
      typeof source.defaultModel === "string" && source.defaultModel.trim()
        ? source.defaultModel.trim()
        : "",
    reasoning:
      source.reasoning === undefined ? true : Boolean(source.reasoning),
    input:
      Array.isArray(source.input) && source.input.length > 0
        ? source.input.map((item) => String(item || "").trim()).filter(Boolean)
        : ["text", "image"],
    contextWindow:
      typeof source.contextWindow === "number" && source.contextWindow > 0
        ? source.contextWindow
        : 128000,
    maxTokens:
      typeof source.maxTokens === "number" && source.maxTokens > 0
        ? source.maxTokens
        : 128000,
    headers: isRecord(source.headers) ? source.headers : {},
    compat: isRecord(source.compat) ? source.compat : {},
  };
}

function resolveActiveProvider(current) {
  return (
    normalizeProviderId(current.provider) ||
    normalizeProviderId(current.platform) ||
    normalizeProviderId(current?.upstream?.provider) ||
    "openai-codex"
  );
}

function ensureActiveProviderConfig(current) {
  const provider = resolveActiveProvider(current);
  current.provider = provider;
  if (!isRecord(current.providers)) {
    current.providers = {};
  }
  const source = isRecord(current.providers[provider])
    ? current.providers[provider]
    : current.upstream;
  current.providers[provider] = normalizeProviderConfigShape(source, provider);
  return current.providers[provider];
}

function parseBooleanInput(raw, fallback) {
  const value = String(raw || "")
    .trim()
    .toLowerCase();
  if (!value) {
    return fallback;
  }
  if (["y", "yes", "true", "1", "on"].includes(value)) {
    return true;
  }
  if (["n", "no", "false", "0", "off"].includes(value)) {
    return false;
  }
  return fallback;
}

function parseNumberInput(raw, fallback) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function normalizeAuthDisplay(authPayload, instructions) {
  const auth =
    authPayload && typeof authPayload === "object" ? authPayload : null;
  const url =
    (auth && typeof auth.url === "string" && auth.url) ||
    (typeof authPayload === "string" ? authPayload : "");
  const resolvedInstructions =
    (auth && typeof auth.instructions === "string" && auth.instructions) ||
    (typeof instructions === "string" ? instructions : "");
  return { url, instructions: resolvedInstructions };
}

function maskSecret(secret) {
  if (!secret) {
    return "";
  }
  if (secret.length <= 6) {
    return "*".repeat(secret.length);
  }
  return `${secret.slice(0, 3)}***${secret.slice(-2)}`;
}

async function askString(rl, label, current, options = {}) {
  const displayValue = options.secret ? maskSecret(current) : current;
  const suffix = displayValue ? ` [${displayValue}]` : "";
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  if (!answer) {
    return current;
  }
  return answer;
}

async function askNumber(rl, label, current) {
  const answer = (await rl.question(`${label} [${current}]: `)).trim();
  if (!answer) {
    return current;
  }
  return parseNumberInput(answer, current);
}

async function askBoolean(rl, label, current) {
  const currentLabel = current ? "Y/n" : "y/N";
  const answer = (await rl.question(`${label} (${currentLabel}): `)).trim();
  return parseBooleanInput(answer, current);
}

function sanitizeConfigForDisplay(config) {
  const providers = {};
  if (isRecord(config.providers)) {
    for (const [providerId, providerConfig] of Object.entries(
      config.providers,
    )) {
      providers[providerId] = {
        ...(isRecord(providerConfig) ? providerConfig : {}),
        apiKey: providerConfig?.apiKey ? "<hidden>" : "",
      };
    }
  }
  return {
    ...config,
    gatewayApiKey: config.gatewayApiKey ? "<hidden>" : "",
    providers,
    upstream: {
      ...config.upstream,
      apiKey: config.upstream.apiKey ? "<hidden>" : "",
    },
  };
}

function resolveHttpConfig(config) {
  const source = isRecord(config?.http) ? config.http : {};
  return {
    maxBodyBytes:
      typeof source.maxBodyBytes === "number" && source.maxBodyBytes > 0
        ? source.maxBodyBytes
        : 1024 * 1024,
    requestTimeoutMs:
      typeof source.requestTimeoutMs === "number" && source.requestTimeoutMs > 0
        ? source.requestTimeoutMs
        : 30_000,
  };
}

function toConfigFileShape(config) {
  const provider = resolveActiveProvider(config);
  const providers = {};
  if (isRecord(config.providers)) {
    for (const [providerId, providerConfig] of Object.entries(
      config.providers,
    )) {
      const normalizedId = normalizeProviderId(providerId);
      if (!normalizedId) {
        continue;
      }
      providers[normalizedId] = normalizeProviderConfigShape(
        providerConfig,
        normalizedId,
      );
    }
  }
  if (!providers[provider]) {
    providers[provider] = normalizeProviderConfigShape(
      config.upstream,
      provider,
    );
  }

  return {
    port: config.port,
    gatewayApiKey: config.gatewayApiKey,
    debug: config.debug,
    provider,
    modelMap: config.modelMap,
    logging: {
      enabled: config.logging.enabled,
      server: config.logging.server,
      conversation: config.logging.conversation,
      dir: config.logging.dir,
    },
    http: resolveHttpConfig(config),
    providers,
  };
}

export function parseCliArgs(argv = []) {
  let configPath = "";
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--config" && argv[i + 1]) {
      configPath = argv[i + 1];
      i += 1;
      continue;
    }
    positional.push(token);
  }

  return {
    command: positional[0] || "help",
    configPath,
    rawArgs: positional.slice(1),
  };
}

async function runUi(configPath) {
  const path = resolveConfigPath(configPath);
  const base = loadConfig({}, { configPath: path });
  const current = toConfigFileShape(base);

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    stdout.write(`\n[piai-router] Config UI\n`);
    stdout.write(`Config file: ${path}\n\n`);

    current.port = await askNumber(rl, "Port", current.port);
    current.debug = await askBoolean(rl, "Debug mode", current.debug);
    current.provider = await askString(rl, "Active provider", current.provider);
    const activeConfig = ensureActiveProviderConfig(current);
    current.logging.enabled = await askBoolean(
      rl,
      "Enable file logging",
      current.logging.enabled,
    );
    current.logging.server = await askBoolean(
      rl,
      "Enable server log",
      current.logging.server,
    );
    current.logging.conversation = await askBoolean(
      rl,
      "Enable conversation log",
      current.logging.conversation,
    );
    current.logging.dir = await askString(
      rl,
      "Log directory",
      current.logging.dir,
    );
    current.http.maxBodyBytes = await askNumber(
      rl,
      "Max request body bytes",
      current.http.maxBodyBytes,
    );
    current.http.requestTimeoutMs = await askNumber(
      rl,
      "Request timeout (ms)",
      current.http.requestTimeoutMs,
    );

    activeConfig.api = await askString(rl, "pi-ai API kind", activeConfig.api);
    activeConfig.authMode = await askString(
      rl,
      "Auth mode (apiKey/oauth)",
      activeConfig.authMode || "apiKey",
    );
    activeConfig.oauthProvider = await askString(
      rl,
      "OAuth provider",
      activeConfig.oauthProvider || current.provider,
    );
    activeConfig.authFile = await askString(
      rl,
      "OAuth auth file",
      activeConfig.authFile || "./piai-auth.json",
    );
    activeConfig.baseUrl = await askString(
      rl,
      "Provider base URL",
      activeConfig.baseUrl,
    );
    activeConfig.defaultModel = await askString(
      rl,
      "Default model",
      activeConfig.defaultModel,
    );
    if (activeConfig.authMode !== "oauth") {
      activeConfig.apiKey = await askString(
        rl,
        "Provider API key",
        activeConfig.apiKey,
        {
          secret: true,
        },
      );
    } else {
      activeConfig.apiKey = "";
    }
    activeConfig.reasoning = await askBoolean(
      rl,
      "Enable reasoning",
      activeConfig.reasoning,
    );

    const inputRaw = await askString(
      rl,
      "Input types (comma-separated)",
      Array.isArray(activeConfig.input)
        ? activeConfig.input.join(",")
        : "text,image",
    );
    activeConfig.input = inputRaw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (activeConfig.input.length === 0) {
      activeConfig.input = ["text", "image"];
    }

    current.gatewayApiKey = await askString(
      rl,
      "Router API key (optional)",
      current.gatewayApiKey,
      {
        secret: true,
      },
    );

    const editModelMap = await askBoolean(rl, "Edit model map JSON now", false);
    if (editModelMap) {
      stdout.write(
        'Enter model map JSON in one line (example: {"openai-codex:claude-sonnet-4-5":"gpt-5.1-codex-mini"})\n',
      );
      const raw = (await rl.question("modelMap JSON: ")).trim();
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (isRecord(parsed)) {
            current.modelMap = parsed;
          } else {
            stdout.write(
              "Invalid modelMap JSON object. Keeping current value.\n",
            );
          }
        } catch {
          stdout.write("Invalid JSON. Keeping current value.\n");
        }
      }
    }
  } finally {
    rl.close();
  }

  writeConfigFile(path, current);
  stdout.write(`\nSaved config to ${path}\n`);
  const savedActiveConfig = ensureActiveProviderConfig(current);
  if (savedActiveConfig.authMode === "oauth") {
    const rl2 = createInterface({ input: stdin, output: stdout });
    let doLogin = false;
    try {
      doLogin = await askBoolean(rl2, "Run OAuth login now", false);
    } finally {
      rl2.close();
    }
    if (doLogin) {
      const cfg = loadConfig({}, { configPath: path });
      await runOAuthLoginWithPrompt(cfg, cfg.upstream.oauthProvider);
    }
  }
  stdout.write("Run `pirouter start` to start the gateway with this config.\n");
}

function runShow(configPath) {
  const config = loadConfig(process.env, {
    configPath: resolveConfigPath(configPath),
  });
  stdout.write(
    `${JSON.stringify(sanitizeConfigForDisplay(config), null, 2)}\n`,
  );
}

async function runStart(configPath) {
  const config = loadConfig(process.env, {
    configPath: resolveConfigPath(configPath),
  });
  const { startServer } = await import("./server.js");
  startServer(config);
}

function runEnv(configPath) {
  const config = loadConfig(process.env, {
    configPath: resolveConfigPath(configPath),
  });
  const env = buildAnthropicEnv(config, {});

  stdout.write(
    `export ANTHROPIC_BASE_URL=${env.ANTHROPIC_BASE_URL}\nexport ANTHROPIC_API_KEY=${env.ANTHROPIC_API_KEY}\n`,
  );
}

function buildAnthropicEnv(config, env = process.env) {
  return {
    ...env,
    ANTHROPIC_BASE_URL: `http://localhost:${config.port}`,
    ANTHROPIC_API_KEY: config.gatewayApiKey || "any-value-or-router-key",
  };
}

function waitForServerReady(server, timeoutMs = 10_000) {
  if (!server || typeof server.once !== "function") {
    return Promise.resolve();
  }
  if (server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onListening = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for pirouter server to start on port ${server?.address?.()?.port || "unknown"}`,
        ),
      );
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      if (typeof server.off === "function") {
        server.off("listening", onListening);
        server.off("error", onError);
      }
    };

    server.once("listening", onListening);
    server.once("error", onError);
  });
}

async function closeServerGracefully(server) {
  if (!server || typeof server.close !== "function") {
    return;
  }
  if (!server.listening) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function runCode(configPath) {
  const config = loadConfig(process.env, {
    configPath: resolveConfigPath(configPath),
  });
  const env = buildAnthropicEnv(config);

  const { startServer } = await import("./server.js");
  const server = startServer(config);
  await waitForServerReady(server);
  stdout.write(`[pirouter] started local router on :${config.port}\n`);

  try {
    await new Promise((resolve, reject) => {
      const child = spawn("claude", ["code"], {
        stdio: "inherit",
        env,
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("exit", (code, signal) => {
        if (signal) {
          reject(new Error(`claude code exited with signal ${signal}`));
          return;
        }
        if (typeof code === "number") {
          process.exitCode = code;
        }
        resolve();
      });
    });
  } finally {
    await closeServerGracefully(server);
  }
}

async function runOAuthLoginWithPrompt(config, explicitProvider) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const provider =
      (typeof explicitProvider === "string" && explicitProvider.trim()
        ? explicitProvider.trim()
        : getOAuthProvider(config, "")) || "openai-codex";

    const result = await runOAuthLogin({
      config,
      provider,
      onAuth: (authPayload, instructions) => {
        const display = normalizeAuthDisplay(authPayload, instructions);

        if (display.url) {
          stdout.write(`\nOpen URL:\n${display.url}\n`);
        } else {
          stdout.write("\nOpen URL: (not provided by provider)\n");
        }
        if (display.instructions) {
          stdout.write(`${display.instructions}\n`);
        }
      },
      onPrompt: async (prompt) => {
        const message =
          prompt &&
          typeof prompt === "object" &&
          typeof prompt.message === "string"
            ? prompt.message
            : "Enter code";
        const answer = await rl.question(`${message}: `);
        return answer.trim();
      },
      onProgress: (message) => {
        stdout.write(`${String(message)}\n`);
      },
    });

    stdout.write(`OAuth login success: provider=${result.provider}\n`);
    stdout.write(`Saved auth file: ${result.authFilePath}\n`);
  } finally {
    rl.close();
  }
}

async function runLogin(configPath, providerArg) {
  const config = loadConfig(process.env, {
    configPath: resolveConfigPath(configPath),
  });
  await runOAuthLoginWithPrompt(
    config,
    providerArg || config.upstream.oauthProvider,
  );
}

function runInit(configPath) {
  const path = resolveConfigPath(configPath);
  if (Object.keys(readConfigFile(path)).length > 0) {
    stdout.write(`Config already exists: ${path}\n`);
    return;
  }
  const config = toConfigFileShape(loadConfig({}, { configPath: path }));
  writeConfigFile(path, config);
  stdout.write(`Created config file: ${path}\n`);
}

function printHelp() {
  stdout.write(`piai-router CLI\n\n`);
  stdout.write(`Usage:\n`);
  stdout.write(
    `  pirouter ui [--config <path>]      # interactive provider setup UI\n`,
  );
  stdout.write(`  pirouter start [--config <path>]   # start gateway server\n`);
  stdout.write(
    `  pirouter show [--config <path>]    # show effective config\n`,
  );
  stdout.write(
    `  pirouter init [--config <path>]    # create config file with defaults\n`,
  );
  stdout.write(
    `  pirouter login [provider] [--config <path>] # OAuth login and save credentials\n`,
  );
  stdout.write(
    `  pirouter env [--config <path>]     # print ANTHROPIC_* export commands\n`,
  );
  stdout.write(
    `  pirouter code [--config <path>]    # run 'claude code' with env applied\n`,
  );
  stdout.write(`  pirouter help\n`);
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  switch (args.command) {
    case "ui":
      await runUi(args.configPath);
      return 0;
    case "start":
      await runStart(args.configPath);
      return 0;
    case "show":
      runShow(args.configPath);
      return 0;
    case "init":
      runInit(args.configPath);
      return 0;
    case "login":
      await runLogin(args.configPath, args.rawArgs[0] || "");
      return 0;
    case "env":
      runEnv(args.configPath);
      return 0;
    case "code":
      await runCode(args.configPath);
      return typeof process.exitCode === "number" ? process.exitCode : 0;
    case "help":
    default:
      printHelp();
      return 0;
  }
}

export const _internal = {
  normalizeAuthDisplay,
  resolveHttpConfig,
};
