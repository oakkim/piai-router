import path from "node:path";
import { readJsonFile, writeJsonFile } from "./config-store.js";

const SUPPORTED_OAUTH_PROVIDERS = new Set([
  "anthropic",
  "openai-codex",
  "github-copilot",
  "google-gemini-cli",
  "google-antigravity"
]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveAuthFilePath(config) {
  const authFileRaw = typeof config?.upstream?.authFile === "string" ? config.upstream.authFile.trim() : "";
  const authFile = authFileRaw || "./piai-auth.json";

  if (path.isAbsolute(authFile)) {
    return authFile;
  }
  const configPath = typeof config?.configPath === "string" ? config.configPath : "";
  if (configPath) {
    return path.resolve(path.dirname(configPath), authFile);
  }
  return path.resolve(process.cwd(), authFile);
}

export function getOAuthProvider(config, explicitProvider) {
  const provider = typeof explicitProvider === "string" && explicitProvider.trim()
    ? explicitProvider.trim()
    : typeof config?.upstream?.oauthProvider === "string" && config.upstream.oauthProvider.trim()
      ? config.upstream.oauthProvider.trim()
      : typeof config?.provider === "string" && config.provider.trim()
        ? config.provider.trim()
      : typeof config?.upstream?.provider === "string" && config.upstream.provider.trim()
        ? config.upstream.provider.trim()
        : "";

  if (!SUPPORTED_OAUTH_PROVIDERS.has(provider)) {
    return "";
  }
  return provider;
}

export function readAuthStore(authFilePath) {
  const data = readJsonFile(authFilePath);
  return isRecord(data) ? data : {};
}

export function writeAuthStore(authFilePath, store) {
  writeJsonFile(authFilePath, store);
}

function resolveLoginFunction(provider, sdk) {
  const map = {
    anthropic: sdk.loginAnthropic,
    "openai-codex": sdk.loginOpenAICodex,
    "github-copilot": sdk.loginGitHubCopilot,
    "google-gemini-cli": sdk.loginGeminiCli,
    "google-antigravity": sdk.loginAntigravity
  };
  return map[provider];
}

export async function runOAuthLogin(params) {
  const { config, provider: explicitProvider, onAuth, onPrompt, onProgress } = params;
  const provider = getOAuthProvider(config, explicitProvider);
  if (!provider) {
    throw new Error("Unsupported OAuth provider.");
  }

  const sdk = await import("@mariozechner/pi-ai");
  const loginFn = resolveLoginFunction(provider, sdk);
  if (typeof loginFn !== "function") {
    throw new Error(`OAuth login function is unavailable for provider: ${provider}`);
  }

  const credentials = await loginFn({
    onAuth,
    onPrompt,
    onProgress
  });

  const authFilePath = resolveAuthFilePath(config);
  const store = readAuthStore(authFilePath);
  store[provider] = { type: "oauth", ...credentials };
  writeAuthStore(authFilePath, store);

  return { provider, authFilePath };
}

export async function resolveOAuthApiKey(config) {
  const provider = getOAuthProvider(config);
  if (!provider) {
    throw new Error("OAuth provider is not configured.");
  }

  const authFilePath = resolveAuthFilePath(config);
  const store = readAuthStore(authFilePath);
  const sdk = await import("@mariozechner/pi-ai");
  const result = await sdk.getOAuthApiKey(provider, store);

  if (!result || typeof result.apiKey !== "string" || !result.apiKey) {
    throw new Error(
      `OAuth credentials not found for provider "${provider}". Run "cli login ${provider}" first.`
    );
  }

  store[provider] = { type: "oauth", ...result.newCredentials };
  writeAuthStore(authFilePath, store);

  return result.apiKey;
}
