import { DEFAULT_LOG_DIR } from "./config-store.js";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePositiveInteger(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  const i = Math.floor(n);
  if (i <= 0) {
    return fallback;
  }
  return i;
}

function normalizePort(value) {
  const port = normalizePositiveInteger(value, 8787);
  if (port > 65535) {
    throw new Error(`Invalid port: ${value}. Expected 1-65535.`);
  }
  return port;
}

function normalizeAuthMode(value) {
  const mode = typeof value === "string" ? value.trim() : "";
  if (!mode) {
    return "apiKey";
  }
  if (mode === "apiKey" || mode === "oauth") {
    return mode;
  }
  throw new Error(`Invalid authMode: ${value}. Expected "apiKey" or "oauth".`);
}

function validateProviderConfig(providerId, providerConfig) {
  if (!isRecord(providerConfig)) {
    throw new Error(`Invalid provider config for "${providerId}".`);
  }

  const normalized = {
    ...providerConfig,
    provider: typeof providerConfig.provider === "string" && providerConfig.provider.trim()
      ? providerConfig.provider.trim()
      : providerId,
    authMode: normalizeAuthMode(providerConfig.authMode)
  };

  if (normalized.authMode === "oauth") {
    const oauthProvider =
      typeof normalized.oauthProvider === "string" && normalized.oauthProvider.trim()
        ? normalized.oauthProvider.trim()
        : normalized.provider;
    const authFile = typeof normalized.authFile === "string" ? normalized.authFile.trim() : "";
    if (!oauthProvider) {
      throw new Error(`Provider "${providerId}" uses oauth but oauthProvider is missing.`);
    }
    if (!authFile) {
      throw new Error(`Provider "${providerId}" uses oauth but authFile is missing.`);
    }
    normalized.oauthProvider = oauthProvider;
    normalized.authFile = authFile;
  }

  if (normalized.authMode === "apiKey") {
    normalized.oauthProvider =
      typeof normalized.oauthProvider === "string" && normalized.oauthProvider.trim()
        ? normalized.oauthProvider.trim()
        : normalized.provider;
  }

  return normalized;
}

function normalizeLogging(logging) {
  const source = isRecord(logging) ? logging : {};
  const dir =
    typeof source.dir === "string" && source.dir.trim()
      ? source.dir.trim()
      : DEFAULT_LOG_DIR;
  return {
    enabled: source.enabled === true,
    server: source.server !== false,
    conversation: source.conversation !== false,
    dir
  };
}

function normalizeHttp(http) {
  const source = isRecord(http) ? http : {};
  return {
    maxBodyBytes: normalizePositiveInteger(source.maxBodyBytes, 1024 * 1024),
    requestTimeoutMs: normalizePositiveInteger(source.requestTimeoutMs, 30_000)
  };
}

export function validateAndNormalizeConfig(config) {
  if (!isRecord(config)) {
    throw new Error("Invalid config object.");
  }

  const providers = isRecord(config.providers) ? config.providers : {};
  const normalizedProviders = {};

  for (const [providerId, providerConfig] of Object.entries(providers)) {
    const key = typeof providerId === "string" ? providerId.trim() : "";
    if (!key) {
      continue;
    }
    normalizedProviders[key] = validateProviderConfig(key, providerConfig);
  }

  const provider = typeof config.provider === "string" && config.provider.trim() ? config.provider.trim() : "";
  if (!provider) {
    throw new Error("Active provider is not configured.");
  }
  if (!normalizedProviders[provider]) {
    throw new Error(`Active provider "${provider}" is not defined in providers.`);
  }

  const normalized = {
    ...config,
    port: normalizePort(config.port),
    provider,
    platform: provider,
    providers: normalizedProviders,
    upstream: {
      ...validateProviderConfig(provider, normalizedProviders[provider]),
      provider
    },
    logging: normalizeLogging(config.logging),
    http: normalizeHttp(config.http)
  };

  return normalized;
}
