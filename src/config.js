import { readConfigFile, resolveConfigPath } from "./config-store.js";
import { validateAndNormalizeConfig } from "./config-validate.js";

const DEFAULT_PROVIDER = "openai-codex";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProviderId(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function defaultProviderConfig(providerId = DEFAULT_PROVIDER) {
  const provider = normalizeProviderId(providerId) || DEFAULT_PROVIDER;
  return {
    api: "openai-codex-responses",
    provider,
    authMode: "apiKey",
    oauthProvider: provider,
    authFile: "./piai-auth.json",
    baseUrl: "https://chatgpt.com/backend-api",
    apiKey: "",
    defaultModel: "gpt-5.1-codex-mini",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 128000,
    maxTokens: 128000,
    headers: {}
  };
}

function defaultConfig() {
  const provider = DEFAULT_PROVIDER;
  const upstream = defaultProviderConfig(provider);
  return {
    port: 8787,
    gatewayApiKey: "",
    debug: false,
    provider,
    platform: provider,
    modelMap: {},
    logging: {
      enabled: false,
      server: true,
      conversation: true,
      dir: "./logs"
    },
    http: {
      maxBodyBytes: 1024 * 1024,
      requestTimeoutMs: 30_000
    },
    providers: {
      [provider]: upstream
    },
    upstream
  };
}

function parseBoolean(raw, fallback) {
  if (raw === undefined) {
    return fallback;
  }
  const value = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }
  return fallback;
}

function parseNumber(raw, fallback) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function parseStringArray(raw, fallback) {
  if (typeof raw !== "string" || !raw.trim()) {
    return fallback;
  }
  const values = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : fallback;
}

function parseJson(raw, fallback) {
  if (typeof raw !== "string" || !raw.trim()) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function mergeProviderConfig(target, candidate, fallbackProvider) {
  if (!isRecord(candidate)) {
    return;
  }
  if (typeof candidate.api === "string" && candidate.api.trim()) {
    target.api = candidate.api.trim();
  }
  if (typeof candidate.provider === "string" && candidate.provider.trim()) {
    target.provider = candidate.provider.trim();
  }
  if (typeof candidate.authMode === "string" && candidate.authMode.trim()) {
    target.authMode = candidate.authMode.trim();
  }
  if (typeof candidate.oauthProvider === "string" && candidate.oauthProvider.trim()) {
    target.oauthProvider = candidate.oauthProvider.trim();
  }
  if (typeof candidate.authFile === "string" && candidate.authFile.trim()) {
    target.authFile = candidate.authFile.trim();
  }
  if (typeof candidate.baseUrl === "string" && candidate.baseUrl.trim()) {
    target.baseUrl = candidate.baseUrl.trim();
  }
  if (typeof candidate.apiKey === "string") {
    target.apiKey = candidate.apiKey;
  }
  if (typeof candidate.defaultModel === "string" && candidate.defaultModel.trim()) {
    target.defaultModel = candidate.defaultModel.trim();
  }
  target.reasoning = parseBoolean(candidate.reasoning, target.reasoning);
  if (typeof candidate.input === "string") {
    target.input = parseStringArray(candidate.input, target.input);
  } else if (Array.isArray(candidate.input)) {
    const normalized = candidate.input
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    if (normalized.length > 0) {
      target.input = normalized;
    }
  }
  target.contextWindow = parseNumber(candidate.contextWindow, target.contextWindow);
  target.maxTokens = parseNumber(candidate.maxTokens, target.maxTokens);
  if (isRecord(candidate.headers)) {
    target.headers = { ...target.headers, ...candidate.headers };
  }
  target.provider = normalizeProviderId(target.provider) || normalizeProviderId(fallbackProvider) || DEFAULT_PROVIDER;
  if (!target.oauthProvider) {
    target.oauthProvider = target.provider;
  }
}

function ensureProviderConfig(config, providerId) {
  const normalizedProvider = normalizeProviderId(providerId) || DEFAULT_PROVIDER;
  if (!isRecord(config.providers)) {
    config.providers = {};
  }
  const base = defaultProviderConfig(normalizedProvider);
  const existing = config.providers[normalizedProvider];
  if (isRecord(existing)) {
    mergeProviderConfig(base, existing, normalizedProvider);
  }
  base.provider = normalizedProvider;
  if (!base.oauthProvider) {
    base.oauthProvider = normalizedProvider;
  }
  config.providers[normalizedProvider] = base;
  return {
    providerId: normalizedProvider,
    providerConfig: base
  };
}

function setActiveProvider(config, providerId) {
  const ensured = ensureProviderConfig(config, providerId);
  config.provider = ensured.providerId;
  config.platform = ensured.providerId;
  return ensured;
}

function mergeConfigWithObject(config, candidate) {
  if (!isRecord(candidate)) {
    return;
  }
  config.port = parseNumber(candidate.port, config.port);
  if (typeof candidate.gatewayApiKey === "string") {
    config.gatewayApiKey = candidate.gatewayApiKey;
  }
  config.debug = parseBoolean(candidate.debug, config.debug);

  const fileProvider = normalizeProviderId(candidate.provider);
  const filePlatform = normalizeProviderId(candidate.platform);
  const hasExplicitProvider = Boolean(fileProvider || filePlatform);

  if (fileProvider) {
    setActiveProvider(config, fileProvider);
  } else if (filePlatform) {
    setActiveProvider(config, filePlatform);
  }

  if (isRecord(candidate.modelMap)) {
    config.modelMap = { ...config.modelMap, ...candidate.modelMap };
  }

  const logging = isRecord(candidate.logging) ? candidate.logging : {};
  config.logging.enabled = parseBoolean(logging.enabled, config.logging.enabled);
  config.logging.server = parseBoolean(logging.server, config.logging.server);
  config.logging.conversation = parseBoolean(logging.conversation, config.logging.conversation);
  if (typeof logging.dir === "string" && logging.dir.trim()) {
    config.logging.dir = logging.dir.trim();
  }

  const http = isRecord(candidate.http) ? candidate.http : {};
  config.http.maxBodyBytes = parseNumber(http.maxBodyBytes, config.http.maxBodyBytes);
  config.http.requestTimeoutMs = parseNumber(http.requestTimeoutMs, config.http.requestTimeoutMs);

  const providers = isRecord(candidate.providers) ? candidate.providers : {};
  for (const [rawProviderId, providerCandidate] of Object.entries(providers)) {
    if (!isRecord(providerCandidate)) {
      continue;
    }
    const providerId =
      normalizeProviderId(rawProviderId) || normalizeProviderId(providerCandidate.provider) || DEFAULT_PROVIDER;
    const { providerConfig } = ensureProviderConfig(config, providerId);
    mergeProviderConfig(providerConfig, providerCandidate, providerId);
    providerConfig.provider = providerId;
    if (!providerConfig.oauthProvider) {
      providerConfig.oauthProvider = providerId;
    }
  }

  const upstream = isRecord(candidate.upstream) ? candidate.upstream : {};
  if (Object.keys(upstream).length > 0) {
    let targetProvider = normalizeProviderId(upstream.provider);
    if (!targetProvider) {
      targetProvider = normalizeProviderId(config.provider) || normalizeProviderId(config.platform) || DEFAULT_PROVIDER;
    } else if (!hasExplicitProvider) {
      setActiveProvider(config, targetProvider);
    }

    const { providerConfig } = ensureProviderConfig(config, targetProvider);
    mergeProviderConfig(providerConfig, upstream, targetProvider);
    providerConfig.provider = targetProvider;
    if (!providerConfig.oauthProvider) {
      providerConfig.oauthProvider = targetProvider;
    }
  }
}

function mergeConfigWithEnv(config, env) {
  if (env.PORT !== undefined) {
    config.port = parseNumber(env.PORT, config.port);
  }
  if (env.GATEWAY_API_KEY !== undefined) {
    config.gatewayApiKey = typeof env.GATEWAY_API_KEY === "string" ? env.GATEWAY_API_KEY : "";
  }
  if (env.DEBUG !== undefined) {
    config.debug = parseBoolean(env.DEBUG, config.debug);
  }

  const envProvider =
    normalizeProviderId(env.PIAI_PROVIDER) ||
    normalizeProviderId(env.PI_PROVIDER) ||
    normalizeProviderId(env.MODEL_PLATFORM);
  if (envProvider) {
    setActiveProvider(config, envProvider);
  }

  const { providerId, providerConfig } = ensureProviderConfig(
    config,
    normalizeProviderId(config.provider) || normalizeProviderId(config.platform) || DEFAULT_PROVIDER
  );

  if (env.PI_API !== undefined && String(env.PI_API).trim()) {
    providerConfig.api = String(env.PI_API).trim();
  }
  if (env.PIAI_AUTH_MODE !== undefined && String(env.PIAI_AUTH_MODE).trim()) {
    providerConfig.authMode = String(env.PIAI_AUTH_MODE).trim();
  }
  if (env.PIAI_OAUTH_PROVIDER !== undefined && String(env.PIAI_OAUTH_PROVIDER).trim()) {
    providerConfig.oauthProvider = String(env.PIAI_OAUTH_PROVIDER).trim();
  }
  if (env.PIAI_AUTH_FILE !== undefined && String(env.PIAI_AUTH_FILE).trim()) {
    providerConfig.authFile = String(env.PIAI_AUTH_FILE).trim();
  }
  if (env.PI_BASE_URL !== undefined && String(env.PI_BASE_URL).trim()) {
    providerConfig.baseUrl = String(env.PI_BASE_URL).trim();
  }
  if (env.PI_API_KEY !== undefined) {
    providerConfig.apiKey = String(env.PI_API_KEY || "");
  }
  if (env.PI_MODEL !== undefined && String(env.PI_MODEL).trim()) {
    providerConfig.defaultModel = String(env.PI_MODEL).trim();
  }
  if (env.PI_REASONING !== undefined) {
    providerConfig.reasoning = parseBoolean(env.PI_REASONING, providerConfig.reasoning);
  }
  if (env.PI_INPUT_TYPES !== undefined) {
    providerConfig.input = parseStringArray(env.PI_INPUT_TYPES, providerConfig.input);
  }
  if (env.PI_CONTEXT_WINDOW !== undefined) {
    providerConfig.contextWindow = parseNumber(env.PI_CONTEXT_WINDOW, providerConfig.contextWindow);
  }
  if (env.PI_MAX_TOKENS !== undefined) {
    providerConfig.maxTokens = parseNumber(env.PI_MAX_TOKENS, providerConfig.maxTokens);
  }
  if (env.PI_HEADERS_JSON !== undefined) {
    providerConfig.headers = parseJson(env.PI_HEADERS_JSON, providerConfig.headers);
  }
  providerConfig.provider = providerId;
  if (!providerConfig.oauthProvider) {
    providerConfig.oauthProvider = providerId;
  }

  const modelMapJson = parseJson(env.MODEL_MAP_JSON, {});
  if (isRecord(modelMapJson)) {
    config.modelMap = { ...config.modelMap, ...modelMapJson };
  }
  if (env.PIAI_LOG_ENABLED !== undefined) {
    config.logging.enabled = parseBoolean(env.PIAI_LOG_ENABLED, config.logging.enabled);
  } else if (env.LOG_ENABLED !== undefined) {
    config.logging.enabled = parseBoolean(env.LOG_ENABLED, config.logging.enabled);
  }
  if (env.PIAI_LOG_SERVER !== undefined) {
    config.logging.server = parseBoolean(env.PIAI_LOG_SERVER, config.logging.server);
  } else if (env.LOG_SERVER !== undefined) {
    config.logging.server = parseBoolean(env.LOG_SERVER, config.logging.server);
  }
  if (env.PIAI_LOG_CONVERSATION !== undefined) {
    config.logging.conversation = parseBoolean(env.PIAI_LOG_CONVERSATION, config.logging.conversation);
  } else if (env.LOG_CONVERSATION !== undefined) {
    config.logging.conversation = parseBoolean(env.LOG_CONVERSATION, config.logging.conversation);
  }
  if (env.PIAI_LOG_DIR !== undefined && String(env.PIAI_LOG_DIR).trim()) {
    config.logging.dir = String(env.PIAI_LOG_DIR).trim();
  } else if (env.LOG_DIR !== undefined && String(env.LOG_DIR).trim()) {
    config.logging.dir = String(env.LOG_DIR).trim();
  }

  if (env.PIAI_MAX_BODY_BYTES !== undefined) {
    config.http.maxBodyBytes = parseNumber(env.PIAI_MAX_BODY_BYTES, config.http.maxBodyBytes);
  }
  if (env.PIAI_REQUEST_TIMEOUT_MS !== undefined) {
    config.http.requestTimeoutMs = parseNumber(env.PIAI_REQUEST_TIMEOUT_MS, config.http.requestTimeoutMs);
  }
}

function finalizeConfig(config) {
  const normalizedProviders = {};
  const rawProviders = isRecord(config.providers) ? config.providers : {};

  for (const [rawProviderId, providerCandidate] of Object.entries(rawProviders)) {
    if (!isRecord(providerCandidate)) {
      continue;
    }
    const providerId =
      normalizeProviderId(rawProviderId) || normalizeProviderId(providerCandidate.provider) || DEFAULT_PROVIDER;
    const providerConfig = defaultProviderConfig(providerId);
    mergeProviderConfig(providerConfig, providerCandidate, providerId);
    providerConfig.provider = providerId;
    if (!providerConfig.oauthProvider) {
      providerConfig.oauthProvider = providerId;
    }
    normalizedProviders[providerId] = providerConfig;
  }

  if (Object.keys(normalizedProviders).length === 0) {
    normalizedProviders[DEFAULT_PROVIDER] = defaultProviderConfig(DEFAULT_PROVIDER);
  }

  const activeProvider =
    normalizeProviderId(config.provider) || normalizeProviderId(config.platform) || DEFAULT_PROVIDER;
  const resolvedProvider = normalizedProviders[activeProvider]
    ? activeProvider
    : Object.keys(normalizedProviders)[0];

  config.providers = normalizedProviders;
  config.provider = resolvedProvider;
  config.platform = resolvedProvider;
  config.upstream = {
    ...normalizedProviders[resolvedProvider],
    provider: resolvedProvider
  };
  if (!config.upstream.oauthProvider) {
    config.upstream.oauthProvider = resolvedProvider;
  }
}

export function loadConfig(env = process.env, options = {}) {
  const configPath = resolveConfigPath(options.configPath ?? env.PIAI_GATEWAY_CONFIG, options.cwd);
  const config = defaultConfig();

  mergeConfigWithObject(config, readConfigFile(configPath));
  mergeConfigWithEnv(config, env);

  if (env.MODEL_MAP_FILE && String(env.MODEL_MAP_FILE).trim()) {
    const fileModelMap = readConfigFile(resolveConfigPath(String(env.MODEL_MAP_FILE).trim(), options.cwd));
    if (isRecord(fileModelMap)) {
      config.modelMap = { ...config.modelMap, ...fileModelMap };
    }
  }

  finalizeConfig(config);

  return { ...validateAndNormalizeConfig(config), configPath };
}
